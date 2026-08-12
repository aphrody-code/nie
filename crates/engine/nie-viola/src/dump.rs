//! **Dump** — extraction massive de toutes les archives CPK vers une arborescence claire.
//!
//! # Ce qui change par rapport aux implémentations amont
//!
//! Trois implémentations existent ailleurs : `Viola.Core/Dump` (C#), son port `src/viola/dump.cpp`
//! (C++), et `Telmo26/ievr_toolbox` (Rust). Les deux premières attribuent **un thread par CPK** en
//! piochant dans une liste non triée ; la troisième trie déjà les packs par taille décroissante,
//! **le point 1 ci-dessous ne la vise donc pas**. En revanche elle déchiffre chaque pack vers un
//! dossier temporaire **sur disque** avant d'extraire, et borne la mémoire par un pool à
//! `Condvar` : ~57 Gio écrits puis relus, là où le mappage mémoire du point 2 rend les deux
//! inutiles.
//!
//! 1. **Ordonnancement.** Les packs d'IEVR sont très inégaux (de quelques Kio à plusieurs Gio).
//!    Avec une file non triée, le temps total est dicté par le dernier gros pack tiré : si un
//!    pack de 6 Gio part en dernier, tous les cœurs l'attendent. Ici les CPK sont triés par
//!    **volume décroissant** avant distribution — c'est l'ordonnancement LPT (*longest
//!    processing time first*), dont la borne de Graham garantit un temps total d'au plus
//!    `4/3 − 1/(3m)` fois l'optimal, là où une file arbitraire n'a aucune borne. Le volume de
//!    chaque pack est **connu d'avance** : il est déjà dans l'index du VFS ([`VfsEntry::file_size`]),
//!    donc l'ordonnancement ne coûte rien de plus qu'un tri.
//!
//! 2. **Empreinte mémoire.** Viola et son port C++ lisent le CPK entier en mémoire (`read_to_end`
//!    / `std::vector`), et `nie_formats::vfs::Vfs::read` fait pire : il **conserve** chaque CPK
//!    déchiffré dans un cache jamais purgé — dumper les ~57 Gio de packs par ce chemin ferait
//!    tenir tout le jeu en RAM. Ici chaque pack est **mappé en mémoire** (`memmap2`) : les pages
//!    sont chargées à la demande et rendues par l'OS, l'occupation reste bornée quel que soit le
//!    nombre de travailleurs.
//!
//! 3. **Recherche d'entrée.** `Vfs::read` retrouve l'entrée d'un fichier par **balayage linéaire**
//!    du sommaire du pack, jusqu'à quatre passes, et recommence pour chaque fichier — soit
//!    `O(N·M)` sur un pack de `N` entrées dont on extrait `M`. Ici le sommaire est parcouru une
//!    fois par pack, et l'extraction se fait directement sur ses entrées.
//!
//! S'y ajoutent deux propriétés qu'**aucune** des trois implémentations amont n'offre : la
//! **reprise** d'un dump interrompu au pack près, et le **saut des fichiers déjà à la bonne
//! taille**, qui rend un second dump quasi instantané.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};

use nie_formats::cpk::CpkReader;
use nie_formats::vfs::Vfs;
use rayon::prelude::*;

use crate::filtre::Filtre;

/// Réglages d'un dump. Les valeurs par défaut sont celles qu'on veut dans une interface :
/// reprise active, réécriture évitée, tous les cœurs.
#[derive(Debug, Clone)]
pub struct DumpOptions {
    /// Ne garder que les chemins retenus par ce filtre (cf. [`Filtre`] : listes, `**`, `!`).
    ///
    /// Un nom de preset se résout d'abord par [`crate::presets::resoudre`].
    pub filtre: Option<String>,
    /// Écrire (et relire) un manifeste de reprise dans le dossier de sortie.
    pub reprise: bool,
    /// Ne pas réécrire un fichier déjà présent à la taille attendue.
    pub sauter_identiques: bool,
    /// Nombre de travailleurs ; `None` = tous les cœurs disponibles.
    pub threads: Option<usize>,
}

impl Default for DumpOptions {
    fn default() -> Self {
        Self { filtre: None, reprise: true, sauter_identiques: true, threads: None }
    }
}

/// Avancement d'un dump, poussé au rythme des fichiers traités.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DumpProgress {
    /// Fichiers traités (extraits, sautés ou en échec).
    pub faits: usize,
    /// Fichiers à traiter au total.
    pub total: usize,
    /// Octets réellement écrits sur le disque.
    pub octets: u64,
}

/// Bilan final d'un dump.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DumpReport {
    /// Fichiers écrits.
    pub extraits: usize,
    /// Fichiers ignorés parce que déjà présents à la bonne taille.
    pub sautes: usize,
    /// Fichiers dont l'extraction ou l'écriture a échoué — jamais fatal.
    pub echecs: usize,
    /// Octets écrits.
    pub octets: u64,
    /// Packs entièrement sautés grâce au manifeste de reprise.
    pub packs_repris: usize,
    /// `true` si l'appelant a demandé l'arrêt avant la fin.
    pub annule: bool,
}

/// Nom du manifeste de reprise, déposé à la racine de la sortie.
const MANIFESTE: &str = ".nie-dump-manifest.json";

/// Packs déjà terminés lors d'un dump précédent, lus depuis le manifeste.
fn lire_manifeste(sortie: &Path) -> Vec<String> {
    std::fs::read_to_string(sortie.join(MANIFESTE))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

/// Enregistre les packs terminés. Écriture par fichier temporaire puis renommage : une coupure
/// pendant l'écriture laisserait sinon un manifeste tronqué, donc un dump « repris » incomplet
/// et silencieusement faux.
fn ecrire_manifeste(sortie: &Path, faits: &[String]) {
    let Ok(json) = serde_json::to_string(faits) else { return };
    let tmp = sortie.join(format!("{MANIFESTE}.tmp"));
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, sortie.join(MANIFESTE));
    }
}

/// Écrit un fichier extrait, en sautant l'écriture si la taille sur disque correspond déjà.
///
/// Renvoie `Ok(true)` si le fichier a été écrit, `Ok(false)` s'il a été sauté.
fn ecrire(dest: &Path, octets: &[u8], sauter_identiques: bool) -> std::io::Result<bool> {
    if sauter_identiques
        && let Ok(m) = std::fs::metadata(dest)
            && m.len() == octets.len() as u64 {
                return Ok(false);
            }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, octets)?;
    Ok(true)
}

/// Extrait tout le VFS (ou la part retenue par le filtre) vers `sortie`.
///
/// `progres` est appelé depuis plusieurs threads : il doit être bon marché et ne rien supposer
/// de l'ordre. `annuler` est consulté entre deux fichiers ; un dump annulé laisse le manifeste
/// cohérent (seuls les packs entièrement terminés y figurent), donc reprenable.
///
/// # Errors
/// Si le dossier de sortie ne peut pas être créé. Les échecs par fichier sont comptés, pas remontés.
pub fn dump_all(
    vfs: &Vfs,
    sortie: &Path,
    options: &DumpOptions,
    annuler: &AtomicBool,
    progres: &(dyn Fn(DumpProgress) + Send + Sync),
) -> Result<DumpReport, String> {
    std::fs::create_dir_all(sortie).map_err(|e| format!("{} : {e}", sortie.display()))?;

    // Compilé une fois : l'ancien chemin réinterprétait le motif pour chacun des 255 308 chemins.
    let filtre = options.filtre.as_deref().map_or_else(Filtre::default, Filtre::parse);

    // ── Regroupement par pack ────────────────────────────────────────────────────────────────
    // Le coût de chaque pack est connu ici même (tailles déjà indexées), ce qui permet de trier
    // avant de distribuer — c'est tout l'intérêt de passer par l'index plutôt que par `Vfs::read`.
    let mut par_cpk: HashMap<&str, (Vec<&str>, u64)> = HashMap::new();
    let mut loose: Vec<&str> = Vec::new();
    for (chemin, entree) in vfs.iter() {
        if !filtre.accepte(chemin) {
            continue;
        }
        if entree.cpk_filename.is_empty() {
            loose.push(chemin);
        } else {
            let e = par_cpk.entry(entree.cpk_filename.as_str()).or_insert((Vec::new(), 0));
            e.0.push(chemin);
            e.1 += u64::from(entree.file_size);
        }
    }

    let deja: Vec<String> = if options.reprise { lire_manifeste(sortie) } else { Vec::new() };
    let packs_repris = par_cpk.keys().filter(|c| deja.iter().any(|d| d == *c)).count();

    // Tri par volume décroissant : ordonnancement LPT (cf. doc du module).
    let mut packs: Vec<(&str, Vec<&str>, u64)> = par_cpk
        .into_iter()
        .filter(|(cpk, _)| !deja.iter().any(|d| d == cpk))
        .map(|(cpk, (fichiers, octets))| (cpk, fichiers, octets))
        .collect();
    packs.sort_unstable_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(b.0)));

    let total: usize = packs.iter().map(|p| p.1.len()).sum::<usize>() + loose.len();

    let faits = AtomicUsize::new(0);
    let extraits = AtomicUsize::new(0);
    let sautes = AtomicUsize::new(0);
    let echecs = AtomicUsize::new(0);
    let octets = AtomicU64::new(0);
    let termines: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(deja.clone());

    // Un compte rendu par fichier saturerait le canal d'événements sur 255 000 entrées : on
    // n'en pousse qu'un tous les 256 fichiers, plus un à la toute fin.
    let signaler = |force: bool| {
        let n = faits.load(Ordering::Relaxed);
        if force || n.is_multiple_of(256) {
            progres(DumpProgress { faits: n, total, octets: octets.load(Ordering::Relaxed) });
        }
    };

    let traiter_pack = |(cpk, fichiers, _): &(&str, Vec<&str>, u64)| {
        if annuler.load(Ordering::Relaxed) {
            return;
        }
        let chemin_pack = vfs.game_data_dir().join("packs").join(cpk);
        // Mappage mémoire : les pages sont paginées à la demande, jamais tout le pack d'un coup.
        let Ok(fichier) = std::fs::File::open(&chemin_pack) else {
            echecs.fetch_add(fichiers.len(), Ordering::Relaxed);
            return;
        };
        // SAFETY : le mappage n'est valide que tant que le fichier n'est pas modifié sous nos
        // pieds. Les packs du jeu sont en lecture seule pendant un dump ; c'est l'hypothèse que
        // fait déjà tout lecteur de CPK du dépôt.
        let Ok(mmap) = (unsafe { memmap2::Mmap::map(&fichier) }) else {
            echecs.fetch_add(fichiers.len(), Ordering::Relaxed);
            return;
        };
        let Ok(lecteur) = CpkReader::new(&mmap, cpk) else {
            echecs.fetch_add(fichiers.len(), Ordering::Relaxed);
            return;
        };

        // Sommaire indexé UNE fois par pack : la recherche d'un fichier devient une consultation
        // de table, au lieu du balayage linéaire refait à chaque fichier par `Vfs::read`.
        let mut index: HashMap<String, usize> = HashMap::with_capacity(lecteur.entries.len());
        for (i, e) in lecteur.entries.iter().enumerate() {
            index.insert(format!("{}/{}", e.directory, e.filename), i);
        }

        // Second niveau de parallélisme : rayon vole le travail entre les deux niveaux, donc un
        // pack unique et énorme occupe quand même tous les cœurs — ce qu'un thread par pack
        // (les deux amonts) ne peut pas faire.
        fichiers.par_iter().for_each(|chemin| {
            if annuler.load(Ordering::Relaxed) {
                return;
            }
            let resultat = index
                .get(*chemin)
                .or_else(|| {
                    // Repli sur le nom de base : l'index supplémentaire (packs hors cpk_list)
                    // stocke des chemins dont la casse a été abaissée par le scan amont.
                    let base = chemin.rsplit('/').next().unwrap_or(chemin);
                    index.iter().find(|(k, _)| k.rsplit('/').next() == Some(base)).map(|(_, v)| v)
                })
                .and_then(|&i| lecteur.extract(&mmap, &lecteur.entries[i]).ok());

            match resultat {
                Some(donnees) => {
                    let dest = sortie.join(chemin.trim_start_matches('/'));
                    match ecrire(&dest, &donnees, options.sauter_identiques) {
                        Ok(true) => {
                            extraits.fetch_add(1, Ordering::Relaxed);
                            octets.fetch_add(donnees.len() as u64, Ordering::Relaxed);
                        }
                        Ok(false) => {
                            sautes.fetch_add(1, Ordering::Relaxed);
                        }
                        Err(_) => {
                            echecs.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
                None => {
                    echecs.fetch_add(1, Ordering::Relaxed);
                }
            }
            faits.fetch_add(1, Ordering::Relaxed);
            signaler(false);
        });

        // Le pack n'entre au manifeste que s'il a été traité en entier : un pack interrompu doit
        // être refait, sans quoi la reprise produirait un dump incomplet réputé complet.
        if !annuler.load(Ordering::Relaxed)
            && let Ok(mut t) = termines.lock() {
                t.push((*cpk).to_string());
                if options.reprise {
                    ecrire_manifeste(sortie, &t);
                }
            }
    };

    // Le nombre de travailleurs est imposé par un pool local : toucher au pool global de rayon
    // depuis une bibliothèque affecterait tout le processus hôte (l'application Tauri).
    let executer = || match options.threads {
        Some(n) if n > 0 => rayon::ThreadPoolBuilder::new()
            .num_threads(n)
            .build()
            .map_err(|e| e.to_string())
            .map(|pool| pool.install(|| packs.par_iter().for_each(traiter_pack))),
        _ => {
            packs.par_iter().for_each(traiter_pack);
            Ok(())
        }
    };
    executer()?;

    // Fichiers loose déclarés dans cpk_list (vidéos d'intro, configuration système) : ils sont
    // déjà sur le disque, une simple copie suffit.
    loose.par_iter().for_each(|chemin| {
        if annuler.load(Ordering::Relaxed) {
            return;
        }
        let source = vfs.game_data_dir().join(chemin.trim_start_matches("data/"));
        let dest = sortie.join(chemin.trim_start_matches('/'));
        match std::fs::read(&source).and_then(|d| {
            let n = d.len() as u64;
            ecrire(&dest, &d, options.sauter_identiques).map(|ecrit| (ecrit, n))
        }) {
            Ok((true, n)) => {
                extraits.fetch_add(1, Ordering::Relaxed);
                octets.fetch_add(n, Ordering::Relaxed);
            }
            Ok((false, _)) => {
                sautes.fetch_add(1, Ordering::Relaxed);
            }
            Err(_) => {
                echecs.fetch_add(1, Ordering::Relaxed);
            }
        }
        faits.fetch_add(1, Ordering::Relaxed);
        signaler(false);
    });

    signaler(true);

    Ok(DumpReport {
        extraits: extraits.into_inner(),
        sautes: sautes.into_inner(),
        echecs: echecs.into_inner(),
        octets: octets.into_inner(),
        packs_repris,
        annule: annuler.load(Ordering::Relaxed),
    })
}

/// Efface le manifeste de reprise — un dump complet reparti de zéro ne doit pas hériter de
/// l'état d'un dump précédent portant un autre filtre.
pub fn oublier_reprise(sortie: &Path) -> std::io::Result<()> {
    let m = sortie.join(MANIFESTE);
    if m.exists() { std::fs::remove_file(m) } else { Ok(()) }
}

/// Chemin du manifeste, pour l'afficher dans une interface.
#[must_use]
pub fn chemin_manifeste(sortie: &Path) -> PathBuf {
    sortie.join(MANIFESTE)
}

/// Rend `Arc`-partageable un rapporteur de progression, utilisé par les appelants qui doivent
/// relayer vers un canal d'événements.
#[must_use]
pub fn rapporteur<F>(f: F) -> Arc<dyn Fn(DumpProgress) + Send + Sync>
where
    F: Fn(DumpProgress) + Send + Sync + 'static,
{
    Arc::new(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_manifeste_survit_a_un_aller_retour() {
        let dir = std::env::temp_dir().join(format!("nie-viola-manif-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dossier de test");
        assert!(lire_manifeste(&dir).is_empty(), "pas de manifeste = rien de repris");
        ecrire_manifeste(&dir, &["a.cpk".to_string(), "b.cpk".to_string()]);
        assert_eq!(lire_manifeste(&dir), vec!["a.cpk".to_string(), "b.cpk".to_string()]);
        oublier_reprise(&dir).expect("effacement");
        assert!(lire_manifeste(&dir).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn l_ecriture_saute_un_fichier_deja_a_la_bonne_taille() {
        let dir = std::env::temp_dir().join(format!("nie-viola-ecrit-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dossier de test");
        let f = dir.join("x.bin");
        assert!(ecrire(&f, b"1234", true).expect("première écriture"), "fichier absent : écrit");
        assert!(!ecrire(&f, b"5678", true).expect("seconde"), "même taille : sauté");
        assert_eq!(std::fs::read(&f).expect("relecture"), b"1234", "le contenu n'a pas bougé");
        assert!(ecrire(&f, b"123", true).expect("taille différente"), "taille différente : réécrit");
        assert!(ecrire(&f, b"123", false).expect("sans saut"), "saut désactivé : toujours écrit");
        std::fs::remove_dir_all(&dir).ok();
    }
}
