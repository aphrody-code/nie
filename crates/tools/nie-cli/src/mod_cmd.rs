//! `niers mod` — le cycle de modding, de bout en bout, en ligne de commande.
//!
//! # Le trou que ce module comble
//!
//! `niers viola` savait **dumper, vérifier, fusionner et packer**, mais pas **éditer**. Les
//! encodeurs existaient pourtant et étaient prouvés sur le jeu réel — `cfgbin::encode_t2b`,
//! `cfgbin::encode_rdbn`, `g4tx_encode::encode_g4tx_single_texture` — sans **aucun appelant**
//! dans cette CLI. Autrement dit, la seule façon de produire un asset modifié était de passer
//! par l'application Tauri. Le cycle n'était complet nulle part en ligne de commande.
//!
//! # Le cycle
//!
//! ```text
//! mod init      un dossier, un manifeste
//! mod add       le fichier vanilla entre dans le mod, tel que le VFS le rend
//! mod get/set   on le lit, on le modifie, il est réencodé
//! mod status    ce que le mod change, comparé au vanilla
//! mod validate  chaque fichier réencodé est relu — un mod qui ne se relit pas ne s'installe pas
//! mod install   merge → pack → copie, après sauvegarde du cpk_list vanilla
//! mod uninstall le cpk_list vanilla revient, à l'octet
//! ```
//!
//! # Deux partis pris
//!
//! **Le pointeur est un JSON Pointer (RFC 6901).** Le format d'édition est celui du pont
//! `nie_explore::bridge`, déjà prouvé par un aller-retour sur le vrai jeu, et c'est exactement
//! ce que l'interface graphique édite. Inventer une syntaxe de chemin propre à la CLI aurait
//! créé un second dialecte à maintenir, et deux façons de désigner le même champ.
//!
//! **`set` ne crée jamais un nœud.** Un pointeur qui ne désigne rien est une erreur, jamais une
//! insertion. La raison est structurelle : `json_to_rdbn_lists` reconstruit les listes **à
//! partir des originales**, et `encode_t2b` attend l'arborescence de conteneurs d'origine.
//! Ajouter un champ produirait soit un refus d'encodage, soit — bien pire — un fichier
//! syntaxiquement valide que le jeu lirait de travers.

use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use clap::Subcommand;
use nie_formats::cfgbin;
use nie_viola::manifeste::{self, Manifeste};
use serde_json::Value;

/// Nom de la sauvegarde du `cpk_list.cfg.bin` vanilla, déposée à côté de lui.
///
/// Le C# amont posait un `.loose_bak` pour le même besoin ; le nom change parce que le geste
/// n'est pas le même (il basculait un fichier isolé, ici on installe un mod entier), et parce
/// qu'un préfixe `nie-` dit d'où vient le fichier quand on le retrouve six mois plus tard.
const SAUVEGARDE: &str = "cpk_list.cfg.bin.nie-vanilla";

/// Chemin de la sauvegarde, résolu à côté du **vrai** `cpk_list.cfg.bin`.
///
/// `data/cpk_list.cfg.bin` est fréquemment un lien symbolique vers l'installation Steam. Composer
/// la sauvegarde à partir du répertoire *non résolu* la fait écrire à un endroit et chercher à un
/// autre dès que la racine est atteinte par un autre chemin : `install` la déposait à côté de la
/// cible du lien, `uninstall` la cherchait à côté du lien lui-même et annonçait « le mod n'a pas
/// été installé » alors que la sauvegarde existait bel et bien.
fn chemin_sauvegarde(cpk_list: &Path) -> PathBuf {
    std::fs::canonicalize(cpk_list)
        .unwrap_or_else(|_| cpk_list.to_path_buf())
        .with_file_name(SAUVEGARDE)
}

/// Au-delà, un `cpk_list` est réputé **déjà packé** par un mod précédent.
///
/// Le jeu a légitimement quelques entrées *loose* (vidéos d'introduction, configuration
/// système) — cinq sur l'installation Steam. Le seuil est celui qu'emploie déjà l'interface
/// graphique via [`nie_viola::PackReport::loose_avant`].
const SEUIL_DEJA_PACKE: usize = 64;

/// Les opérations du cycle de modding.
#[derive(Subcommand)]
pub enum ModOp {
    /// Crée un dossier de mod et son manifeste.
    Init {
        /// Nom du mod — sert aussi d'identifiant aux dépendances.
        #[arg(long)]
        nom: String,
        /// Auteur ou équipe.
        #[arg(long)]
        auteur: String,
        /// Dossier du mod (créé s'il manque).
        #[arg(long, short = 'd', default_value = ".")]
        dir: PathBuf,
        /// Description libre.
        #[arg(long, default_value = "")]
        description: String,
    },
    /// Fait entrer un ou plusieurs fichiers **vanilla** dans le mod, prêts à être édités.
    Add {
        /// Chemins VFS (`data/common/gamedata/...`). Un préfixe de dossier prend tout ce qu'il
        /// contient.
        #[arg(required = true, num_args = 1..)]
        chemins: Vec<String>,
        #[arg(long, short = 'd', default_value = ".")]
        dir: PathBuf,
        /// Réécrit le fichier même s'il est déjà dans le mod (les éditions seraient perdues).
        #[arg(long)]
        ecraser: bool,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Affiche un fichier du mod (ou son vanilla) en JSON, entier ou à un pointeur.
    Get {
        /// Chemin VFS.
        chemin: String,
        /// JSON Pointer (RFC 6901), ex. `/entries/0/children/3/variables/2/value`.
        #[arg(long, short = 'p')]
        pointeur: Option<String>,
        /// Tronque l'affichage à N caractères (0 = pas de troncature).
        #[arg(long, default_value_t = 4096)]
        limite: usize,
        #[arg(long, short = 'd', default_value = ".")]
        dir: PathBuf,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Modifie un champ et réencode le fichier dans le mod.
    Set {
        /// Chemin VFS.
        chemin: String,
        /// JSON Pointer du champ à modifier — doit désigner un nœud **existant**.
        pointeur: String,
        /// Nouvelle valeur. Interprétée comme du texte si le nœud actuel est une chaîne
        /// (le cas normal dans ce format), comme du JSON sinon.
        valeur: String,
        #[arg(long, short = 'd', default_value = ".")]
        dir: PathBuf,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Remplace une texture par un PNG (g4tx mono-texture, sans région d'atlas).
    Texture {
        /// Chemin VFS du `.g4tx`.
        chemin: String,
        /// Image source.
        #[arg(long)]
        png: PathBuf,
        #[arg(long, short = 'd', default_value = ".")]
        dir: PathBuf,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Ce que le mod change, fichier par fichier, comparé au vanilla du VFS.
    Status {
        #[arg(long, short = 'd', default_value = ".")]
        dir: PathBuf,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Vérifie le manifeste, l'arborescence, et que chaque fichier se relit après encodage.
    Validate {
        #[arg(long, short = 'd', default_value = ".")]
        dir: PathBuf,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Installe le mod dans le jeu : sauvegarde le `cpk_list`, le réécrit, copie les fichiers.
    Install {
        /// Dossiers de mods, du **moins** au **plus** prioritaire si plusieurs.
        #[arg(long, short = 'd', default_value = ".", num_args = 1..)]
        dir: Vec<PathBuf>,
        #[arg(long)]
        game_dir: Option<PathBuf>,
        /// Cible Switch (`romfs/data/…`) au lieu de PC.
        #[arg(long)]
        switch: bool,
        /// Montre ce qui serait fait, sans rien écrire.
        #[arg(long)]
        a_blanc: bool,
    },
    /// Rend au jeu son `cpk_list.cfg.bin` d'origine.
    Uninstall {
        #[arg(long)]
        game_dir: Option<PathBuf>,
        /// Supprime aussi les fichiers du mod copiés dans le jeu.
        #[arg(long, short = 'd')]
        dir: Option<PathBuf>,
    },
}

/// Un `.cfg.bin` décodé, avec de quoi le réencoder dans **sa** variante.
///
/// Les deux variantes ne se ré-encodent pas de la même façon : le RDBN a besoin de ses listes
/// d'origine comme gabarit (la forme JSON n'encode pas les types de champs), le T2B non.
enum Doc {
    /// Arbre T2B.
    T2b,
    /// Listes RDBN, conservées comme gabarit de réencodage.
    Rdbn(Vec<cfgbin::RdbnList>),
}

/// Décode des octets `.cfg.bin` vers la forme JSON du pont, quelle que soit la variante.
fn charger(octets: &[u8]) -> anyhow::Result<(Doc, Value)> {
    if cfgbin::is_rdbn(octets) {
        let brut = cfgbin::parse(octets).map_err(|e| anyhow::anyhow!("RDBN illisible : {e}"))?;
        let listes = cfgbin::read_values(&brut, octets);
        let json = nie_explore::bridge::rdbn_to_json(&listes);
        return Ok((Doc::Rdbn(listes), json));
    }
    let cfg = cfgbin::cfgbin_parse(octets).map_err(|e| anyhow::anyhow!("T2B illisible : {e}"))?;
    let json = nie_explore::bridge::t2b_to_json(&cfg);
    Ok((Doc::T2b, json))
}

/// Réencode la forme JSON dans la variante d'origine.
fn reencoder(doc: &Doc, json: &Value) -> anyhow::Result<Vec<u8>> {
    match doc {
        Doc::T2b => {
            let entries = nie_explore::bridge::json_to_t2b_entries(json)
                .map_err(|e| anyhow::anyhow!("JSON → T2B : {e}"))?;
            Ok(cfgbin::encode_t2b(&entries))
        }
        Doc::Rdbn(original) => {
            let listes = nie_explore::bridge::json_to_rdbn_lists(original, json)
                .map_err(|e| anyhow::anyhow!("JSON → RDBN : {e}"))?;
            cfgbin::encode_rdbn(&listes).map_err(|e| anyhow::anyhow!("encodage RDBN : {e}"))
        }
    }
}

/// Ramène un pointeur à la forme RFC 6901, en tolérant l'absence du `/` initial.
///
/// Ce n'est pas de la complaisance : sous Git Bash, MSYS réécrit **tout** argument commençant
/// par `/` en chemin Windows, si bien que `/entries/0/...` arrive au programme sous la forme
/// `C:/Program Files/Git/entries/0/...`. L'erreur qui en découle accuse le pointeur alors que
/// le shell est en cause. Accepter `entries/0/...` donne une forme qui traverse le shell intacte.
fn normaliser_pointeur(p: &str) -> String {
    if p.is_empty() || p.starts_with('/') {
        p.to_string()
    } else {
        format!("/{p}")
    }
}

/// Compte les entrées **déjà hors paquet** d'un `cpk_list.cfg.bin`.
///
/// C'est le seul moyen de reconnaître un `cpk_list` qu'un mod précédent a déjà réécrit : le
/// fichier n'en porte aucune marque, et repartir de lui empilerait les deux mods. Un
/// `cpk_list` illisible rend `0` — on ne bloquera pas l'installation sur un fichier qu'on n'a
/// pas su lire, `pack_mod` échouera de toute façon avec une meilleure erreur.
fn compter_loose(cpk_list: &[u8]) -> usize {
    let Ok((cfg, _)) = nie_viola::decode_cpk_list(cpk_list) else {
        return 0;
    };
    cfg.entries.first().map_or(0, |racine| {
        racine
            .children
            .iter()
            .filter(|e| {
                e.variables.len() >= 5
                    && matches!(&e.variables[3], cfgbin::Value::String(s) if s.is_empty())
            })
            .count()
    })
}

/// Emplacement d'un chemin VFS à l'intérieur d'un dossier de mod.
fn dans_le_mod(dir: &Path, vfs: &str) -> PathBuf {
    dir.join(vfs.trim_start_matches('/'))
}

/// Octets d'un fichier : ceux du mod s'il y est, sinon le vanilla lu dans le VFS.
///
/// L'ordre compte : éditer deux fois de suite le même champ doit partir de la première édition,
/// pas repartir du vanilla en écrasant silencieusement la précédente.
fn octets_courants(dir: &Path, vfs: &str, game_dir: Option<PathBuf>) -> anyhow::Result<Vec<u8>> {
    let p = dans_le_mod(dir, vfs);
    if p.is_file() {
        return std::fs::read(&p).with_context(|| format!("lecture « {} »", p.display()));
    }
    let v = crate::open_vfs(game_dir)?;
    v.read(vfs)
        .map_err(|e| anyhow::anyhow!("« {vfs} » introuvable dans le VFS : {e}"))
}

/// Écrit un fichier dans le mod, en créant l'arborescence.
fn ecrire_dans_le_mod(dir: &Path, vfs: &str, octets: &[u8]) -> anyhow::Result<PathBuf> {
    let p = dans_le_mod(dir, vfs);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("création « {} »", parent.display()))?;
    }
    std::fs::write(&p, octets).with_context(|| format!("écriture « {} »", p.display()))?;
    Ok(p)
}

/// Aiguillage des sous-commandes.
///
/// # Errors
/// Remonte toute erreur d'E/S, de format ou de validation.
pub fn executer(op: ModOp) -> anyhow::Result<()> {
    match op {
        ModOp::Init {
            nom,
            auteur,
            dir,
            description,
        } => init(&nom, &auteur, &dir, &description),
        ModOp::Add {
            chemins,
            dir,
            ecraser,
            game_dir,
        } => add(&chemins, &dir, ecraser, game_dir),
        ModOp::Get {
            chemin,
            pointeur,
            limite,
            dir,
            game_dir,
        } => get(&chemin, pointeur.as_deref(), limite, &dir, game_dir),
        ModOp::Set {
            chemin,
            pointeur,
            valeur,
            dir,
            game_dir,
        } => set(&chemin, &pointeur, &valeur, &dir, game_dir),
        ModOp::Texture {
            chemin,
            png,
            dir,
            game_dir,
        } => texture(&chemin, &png, &dir, game_dir),
        ModOp::Status { dir, game_dir } => status(&dir, game_dir),
        ModOp::Validate { dir, game_dir } => validate(&dir, game_dir).map(|_| ()),
        ModOp::Install {
            dir,
            game_dir,
            switch,
            a_blanc,
        } => install(&dir, game_dir, switch, a_blanc),
        ModOp::Uninstall { game_dir, dir } => uninstall(game_dir, dir.as_deref()),
    }
}

fn init(nom: &str, auteur: &str, dir: &Path, description: &str) -> anyhow::Result<()> {
    if Manifeste::chemin(dir).exists() {
        bail!(
            "« {} » contient déjà un mod — `init` n'écrase pas",
            dir.display()
        );
    }
    let mut m = Manifeste::gabarit(nom, auteur);
    m.description = description.to_string();
    m.ecrire(dir).map_err(anyhow::Error::msg)?;
    println!("mod       {nom} v{} par {auteur}", m.version);
    println!("manifeste {}", Manifeste::chemin(dir).display());
    println!("\nEnsuite : `niers mod add <chemin-vfs>` pour y faire entrer un fichier du jeu.");
    Ok(())
}

fn add(
    chemins: &[String],
    dir: &Path,
    ecraser: bool,
    game_dir: Option<PathBuf>,
) -> anyhow::Result<()> {
    let vfs = crate::open_vfs(game_dir)?;
    // Un préfixe de dossier vaut pour tout ce qu'il contient : ajouter une famille entière au
    // mod est le geste courant, et l'énumérer à la main sur des milliers d'entrées ne l'est pas.
    let mut cibles: Vec<String> = Vec::new();
    for c in chemins {
        let c = c.trim_matches('/');
        if vfs.iter().any(|(p, _)| p == c) {
            cibles.push(c.to_string());
            continue;
        }
        let prefixe = format!("{c}/");
        let sous: Vec<String> = vfs
            .iter()
            .map(|(p, _)| p)
            .filter(|p| p.starts_with(&prefixe))
            .map(String::from)
            .collect();
        if sous.is_empty() {
            bail!("« {c} » n'est ni un fichier ni un dossier du VFS");
        }
        cibles.extend(sous);
    }
    cibles.sort_unstable();
    cibles.dedup();

    let (mut ajoutes, mut sautes, mut echecs) = (0usize, 0usize, 0usize);
    for vfs_path in &cibles {
        if !ecraser && dans_le_mod(dir, vfs_path).is_file() {
            sautes += 1;
            continue;
        }
        match vfs.read(vfs_path) {
            Ok(octets) => {
                ecrire_dans_le_mod(dir, vfs_path, &octets)?;
                ajoutes += 1;
            }
            Err(e) => {
                eprintln!("  échec  {vfs_path} : {e}");
                echecs += 1;
            }
        }
    }
    println!("ajoutés   {ajoutes}");
    if sautes > 0 {
        println!("sautés    {sautes} (déjà dans le mod — `--ecraser` pour repartir du vanilla)");
    }
    if echecs > 0 {
        println!("échecs    {echecs}");
    }
    Ok(())
}

fn get(
    chemin: &str,
    pointeur: Option<&str>,
    limite: usize,
    dir: &Path,
    game_dir: Option<PathBuf>,
) -> anyhow::Result<()> {
    let octets = octets_courants(dir, chemin, game_dir)?;
    let (_, json) = charger(&octets)?;
    let pointeur = pointeur.map(normaliser_pointeur);
    let vue = match &pointeur {
        None => &json,
        Some(p) => json.pointer(p).ok_or_else(|| {
            anyhow::anyhow!("le pointeur « {p} » ne désigne rien dans ce fichier")
        })?,
    };
    let texte = serde_json::to_string_pretty(vue)?;
    if limite > 0 && texte.len() > limite {
        // Compter en caractères et non en octets : tronquer au milieu d'un caractère multioctet
        // produirait une chaîne invalide, et ces fichiers portent du texte japonais.
        let coupe: String = texte.chars().take(limite).collect();
        println!("{coupe}");
        println!(
            "… tronqué à {limite} caractères sur {} — `--limite 0` pour tout voir",
            texte.chars().count()
        );
    } else {
        println!("{texte}");
    }
    Ok(())
}

fn set(
    chemin: &str,
    pointeur: &str,
    valeur: &str,
    dir: &Path,
    game_dir: Option<PathBuf>,
) -> anyhow::Result<()> {
    let octets = octets_courants(dir, chemin, game_dir)?;
    let (doc, mut json) = charger(&octets)?;
    let pointeur = &normaliser_pointeur(pointeur);

    let cible = json.pointer_mut(pointeur).ok_or_else(|| {
        anyhow::anyhow!(
            "le pointeur « {pointeur} » ne désigne rien — `set` ne crée jamais un champ, \
             car un champ ajouté ne serait pas réencodable (cf. doc du module)"
        )
    })?;

    let avant = cible.clone();
    // Dans la forme du pont, toute valeur de variable est une chaîne — y compris les entiers et
    // les flottants, que les lecteurs de `nie-data` re-parsent. Respecter le type en place évite
    // de produire un JSON que l'encodeur refusera.
    if cible.is_string() {
        *cible = Value::String(valeur.to_string());
    } else {
        *cible = serde_json::from_str(valeur).with_context(|| {
            format!("« {valeur} » n'est pas du JSON, et le nœud visé n'est pas une chaîne")
        })?;
    }
    let apres = cible.clone();

    let nouveaux = reencoder(&doc, &json)?;
    // Relire ce qu'on vient d'écrire, tout de suite : un encodage qui ne se redécode pas doit
    // échouer ici, pas au moment de l'installation, et surtout pas dans le jeu.
    let (_, verif) =
        charger(&nouveaux).context("le fichier réencodé ne se relit pas — modification refusée")?;
    // Dire ce qui a été relu, et non pas seulement que ça diffère : sans la valeur trouvée, on
    // ne distingue pas un pointeur qui a glissé (nœud absent) d'un reformatage de la valeur.
    match verif.pointer(pointeur) {
        Some(relu) if relu == &apres => {}
        Some(relu) => {
            bail!("le fichier réencodé rend {relu} là où {apres} a été posé — modification refusée")
        }
        None => {
            // Dire OÙ le chemin se brise : un pointeur perdu sans plus de précision ne se
            // diagnostique pas. On redescend segment par segment jusqu'au premier absent.
            let mut chemin = String::new();
            let mut rompu = String::from("(racine)");
            for seg in pointeur.split('/').skip(1) {
                chemin.push('/');
                chemin.push_str(seg);
                if verif.pointer(&chemin).is_none() {
                    rompu = chemin.clone();
                    break;
                }
            }
            let avant_rupture = rompu.rsplit_once('/').map_or("", |(p, _)| p).to_string();
            let dispo = verif.pointer(&avant_rupture).map_or_else(
                || "—".to_string(),
                |v| match v {
                    Value::Array(a) => format!("tableau de {} éléments", a.len()),
                    Value::Object(o) => {
                        format!(
                            "objet {{{}}}",
                            o.keys().cloned().collect::<Vec<_>>().join(", ")
                        )
                    }
                    autre => format!("{autre}"),
                },
            );
            bail!(
                "après réencodage, le pointeur « {pointeur} » se brise à « {rompu} » ; \
                 « {avant_rupture} » contient : {dispo} — modification refusée"
            )
        }
    }

    let p = ecrire_dans_le_mod(dir, chemin, &nouveaux)?;
    println!("fichier   {}", p.display());
    println!("pointeur  {pointeur}");
    println!("avant     {avant}");
    println!("après     {apres}");
    println!("octets    {} → {}", octets.len(), nouveaux.len());
    Ok(())
}

fn texture(chemin: &str, png: &Path, dir: &Path, game_dir: Option<PathBuf>) -> anyhow::Result<()> {
    let octets = octets_courants(dir, chemin, game_dir)?;
    let atlas = nie_formats::g4tx::parse(&octets)
        .map_err(|e| anyhow::anyhow!("« {chemin} » n'est pas un G4TX lisible : {e}"))?;
    // Même restriction que l'interface graphique, et pour la même raison : dans un atlas
    // multi-région, plusieurs régions partagent une texture — « remplacer » n'y a pas de sens
    // univoque. Refuser vaut mieux que produire un atlas dont les autres régions sont fausses.
    if atlas.header.texture_count != 1 || atlas.header.sub_texture_count != 0 {
        bail!(
            "« {chemin} » est un atlas ({} texture(s), {} région(s)) — seul le g4tx mono-texture \
             sans région est remplaçable aujourd'hui",
            atlas.header.texture_count,
            atlas.header.sub_texture_count
        );
    }
    let tex = atlas
        .textures
        .first()
        .ok_or_else(|| anyhow::anyhow!("{chemin} : aucune texture"))?;

    let image = std::fs::read(png).with_context(|| format!("lecture « {} »", png.display()))?;
    let (l, h, rgba) = nie_formats::g4tx_encode::decode_png_to_rgba8(&image)
        .map_err(|e| anyhow::anyhow!("« {} » : {e}", png.display()))?;
    let dds = nie_formats::g4tx_encode::encode_dds_bgra8(l, h, &rgba)
        .map_err(|e| anyhow::anyhow!("encodage DDS : {e}"))?;
    let (li, hi) = (i16::try_from(l)?, i16::try_from(h)?);
    let nouveaux =
        nie_formats::g4tx_encode::encode_g4tx_single_texture(&tex.name, tex.id, li, hi, &dds);

    let p = ecrire_dans_le_mod(dir, chemin, &nouveaux)?;
    println!("texture   {} — {l}×{h}", tex.name);
    println!("fichier   {}", p.display());
    println!("octets    {} → {}", octets.len(), nouveaux.len());
    Ok(())
}

fn status(dir: &Path, game_dir: Option<PathBuf>) -> anyhow::Result<()> {
    let m = Manifeste::lire(dir).map_err(anyhow::Error::msg)?;
    let fichiers = manifeste::fichiers(dir).map_err(anyhow::Error::msg)?;
    println!("mod       {} v{} par {}", m.nom, m.version, m.auteur);
    if !m.description.is_empty() {
        println!("           {}", m.description);
    }
    println!("priorité  {}", m.priorite);
    println!("fichiers  {}", fichiers.len());

    if fichiers.is_empty() {
        return Ok(());
    }
    let vfs = crate::open_vfs(game_dir)?;
    let (mut modifies, mut neufs, mut identiques) = (0usize, 0usize, 0usize);
    for f in &fichiers {
        let taille = std::fs::metadata(&f.absolu).map(|x| x.len()).unwrap_or(0);
        match vfs.read(&f.vfs) {
            Err(_) => {
                neufs += 1;
                println!(
                    "  neuf       {} ({taille} o) — absent du jeu vanilla",
                    f.vfs
                );
            }
            Ok(vanilla) => {
                let a_jour = std::fs::read(&f.absolu).unwrap_or_default();
                if a_jour == vanilla {
                    identiques += 1;
                } else {
                    modifies += 1;
                    println!("  modifié    {} ({} → {taille} o)", f.vfs, vanilla.len());
                }
            }
        }
    }
    if identiques > 0 {
        // Un fichier identique au vanilla ne change rien mais bascule quand même son entrée en
        // loose : ce n'est pas neutre, et le taire donnerait un mod plus gros que son effet.
        println!(
            "  {identiques} identique(s) au vanilla — sans effet, mais installé(s) quand même"
        );
    }
    println!("bilan     {modifies} modifié(s), {neufs} neuf(s), {identiques} identique(s)");
    Ok(())
}

/// Vérifie un mod et rend ses fichiers. Le cœur partagé par `validate` et `install`.
fn validate(dir: &Path, game_dir: Option<PathBuf>) -> anyhow::Result<Vec<manifeste::FichierMod>> {
    let m = Manifeste::lire(dir).map_err(anyhow::Error::msg)?;
    let mut fautes: Vec<String> = m.reproches();

    // Un fichier hors `data/` ne serait jamais chargé, et surtout jamais signalé : c'est le
    // piège exact du dossier de travail à noms aplatis.
    for f in manifeste::valider_arborescence(dir).map_err(anyhow::Error::msg)? {
        fautes.push(format!(
            "« {f} » n'est pas sous data/ — le jeu ne le chargerait jamais"
        ));
    }

    let fichiers = manifeste::fichiers(dir).map_err(anyhow::Error::msg)?;
    let vfs = crate::open_vfs(game_dir).ok();
    for f in &fichiers {
        // Un chemin absent du VFS n'est pas fatal (un mod peut ajouter un fichier), mais c'est
        // presque toujours une faute de frappe : le dire sans refuser.
        if let Some(v) = &vfs
            && !v.iter().any(|(p, _)| p == f.vfs)
        {
            println!(
                "  note     {} est absent du jeu vanilla (fichier ajouté ?)",
                f.vfs
            );
        }
        if !f.vfs.ends_with(".cfg.bin") {
            continue;
        }
        // La vraie vérification : un `.cfg.bin` du mod doit se décoder. S'il ne se décode pas
        // ici, le jeu ne le lira pas davantage.
        let octets = std::fs::read(&f.absolu)
            .with_context(|| format!("lecture « {} »", f.absolu.display()))?;
        if let Err(e) = charger(&octets) {
            fautes.push(format!("{} : illisible — {e}", f.vfs));
        }
    }

    if fautes.is_empty() {
        println!(
            "mod       {} v{} — {} fichier(s)",
            m.nom,
            m.version,
            fichiers.len()
        );
        println!("verdict   valide");
        return Ok(fichiers);
    }
    for f in &fautes {
        println!("  faute    {f}");
    }
    bail!("{} faute(s) — mod invalide", fautes.len())
}

fn install(
    dirs: &[PathBuf],
    game_dir: Option<PathBuf>,
    switch: bool,
    a_blanc: bool,
) -> anyhow::Result<()> {
    let racine = crate::racine_jeu(game_dir.clone());
    let data = racine.join("data");
    let cpk_list = data.join("cpk_list.cfg.bin");
    let sauvegarde = chemin_sauvegarde(&cpk_list);
    if !cpk_list.is_file() {
        bail!(
            "« {} » introuvable — ce n'est pas une installation du jeu",
            cpk_list.display()
        );
    }

    // Valider AVANT de toucher au jeu. Un mod refusé ne doit laisser aucune trace.
    let mut manifestes = Vec::with_capacity(dirs.len());
    for d in dirs {
        validate(d, game_dir.clone())?;
        manifestes.push(Manifeste::lire(d).map_err(anyhow::Error::msg)?);
    }
    // L'ordre d'application vient des dépendances puis de la priorité, jamais de l'ordre de
    // frappe sur la ligne de commande — sinon `enabled`/`priorite` resteraient décoratifs.
    let ordre = nie_viola::ordonner(&manifestes).map_err(anyhow::Error::msg)?;
    let sources: Vec<PathBuf> = ordre.iter().rev().map(|&i| dirs[i].clone()).collect();
    if sources.len() > 1 {
        println!(
            "ordre     {} (du plus prioritaire au moins prioritaire)",
            sources
                .iter()
                .filter_map(|p| p.file_name())
                .map(|n| n.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" > ")
        );
    }

    // Le `cpk_list` passé à `pack_mod` doit être le vanilla : repartir d'un cpk_list déjà packé
    // empilerait les entrées d'un mod précédent. La sauvegarde est donc la source, toujours.
    if !sauvegarde.exists() {
        let vanilla = std::fs::read(&cpk_list)?;
        let deja_loose = compter_loose(&vanilla);
        if deja_loose > SEUIL_DEJA_PACKE {
            bail!(
                "ce cpk_list porte déjà {deja_loose} entrées hors paquet : il a été packé par \
                 un mod précédent et aucune sauvegarde n'existe. Restaurez le fichier vanilla \
                 (vérification des fichiers par Steam) avant d'installer."
            );
        }
        if a_blanc {
            println!(
                "à blanc   sauvegarderait {} → {}",
                cpk_list.display(),
                sauvegarde.display()
            );
        } else {
            std::fs::copy(&cpk_list, &sauvegarde)?;
            println!("sauvegarde {}", sauvegarde.display());
        }
    } else {
        println!(
            "sauvegarde {} (déjà présente, réutilisée comme vanilla)",
            sauvegarde.display()
        );
    }

    if a_blanc {
        for d in &sources {
            let n = manifeste::fichiers(d).map_err(anyhow::Error::msg)?.len();
            println!(
                "à blanc   {} : {n} fichier(s) vers {}",
                d.display(),
                racine.display()
            );
        }
        println!("à blanc   rien n'a été écrit");
        return Ok(());
    }

    // Plusieurs mods : les fusionner d'abord, au champ, ce qui laisse survivre deux mods qui
    // touchent des champs différents d'un même fichier.
    let temporaire = std::env::temp_dir().join(format!("nie-mod-fusion-{}", std::process::id()));
    let source_unique = if sources.len() == 1 {
        sources[0].clone()
    } else {
        let vfs = crate::open_vfs(game_dir.clone())?;
        let resoudre = |rel: &str| vfs.read(rel).ok();
        let r = nie_viola::merge_dirs(
            &sources,
            &temporaire,
            &nie_viola::MergeStrategy::Semantique(&resoudre),
        )
        .map_err(anyhow::Error::msg)?;
        println!(
            "fusion    {} copiés, {} fusionnés, {} conflits",
            r.copies,
            r.fusionnes,
            r.conflits.len()
        );
        for c in &r.conflits {
            println!(
                "  conflit  {} — {} champs en désaccord",
                c.chemin, c.champs_en_desaccord
            );
        }
        temporaire.clone()
    };

    let _ = switch; // la plateforme ne change rien au patch d'octets : même format, même enveloppe.

    // Installation par **patch d'octets**, jamais par réencodage. `encode_t2b` n'est pas fidèle
    // sur ce fichier — mesuré : −27 octets et 5,4 M d'octets différents pour un aller-retour à
    // vide — et le jeu refuse alors le `cpk_list` (E-02000000), y compris quand le mod est
    // rigoureusement identique au vanilla. Ici on déchiffre, on écrit 4 octets par fichier, on
    // rechiffre : l'enveloppe AES, elle, est fidèle.
    let vanilla = std::fs::read(&sauvegarde)?;
    let mut clair = nie_formats::cpk::decrypt_cpk_list(&vanilla)
        .map_err(|e| anyhow::anyhow!("déchiffrement du cpk_list : {e}"))?;
    let avant = clair.len();

    let fichiers = manifeste::fichiers(&source_unique).map_err(anyhow::Error::msg)?;
    let chemins: Vec<String> = fichiers.iter().map(|f| f.vfs.clone()).collect();
    let rapport =
        nie_viola::patch::patcher_clair(&mut clair, &chemins).map_err(anyhow::Error::msg)?;
    anyhow::ensure!(
        clair.len() == avant,
        "le patch a changé la taille du cpk_list — abandon"
    );

    if !rapport.introuvables.is_empty() {
        // Ajouter une entrée déplacerait tous les offsets : hors de portée d'un patch en place.
        bail!(
            "{} fichier(s) absent(s) du cpk_list — l'installation par patch ne sait que \
             REMPLACER un fichier existant, pas en AJOUTER un neuf : {}",
            rapport.introuvables.len(),
            rapport.introuvables.join(", ")
        );
    }

    let rechiffre = nie_formats::cpk::encrypt_cpk_list(&clair);
    anyhow::ensure!(
        rechiffre.len() == vanilla.len(),
        "le rechiffrement a changé la taille ({} → {}) — abandon",
        vanilla.len(),
        rechiffre.len()
    );
    std::fs::write(&cpk_list, &rechiffre)?;

    // Copier les fichiers du mod là où le jeu les cherchera désormais.
    let mut copies = 0usize;
    for f in &fichiers {
        let dest = racine.join(&f.vfs);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&f.absolu, &dest)?;
        copies += 1;
    }
    std::fs::remove_dir_all(&temporaire).ok();

    println!("rendus loose {}", rapport.rendus_loose.len());
    println!("déjà loose   {}", rapport.deja_loose.len());
    println!(
        "octets patchés {} (sur {} du cpk_list)",
        rapport.octets_modifies, avant
    );
    println!("copiés     {copies}");
    println!("installé dans {}", racine.display());
    println!("\n`niers mod uninstall` rend au jeu son cpk_list d'origine, à l'octet.");
    Ok(())
}

fn uninstall(game_dir: Option<PathBuf>, dir: Option<&Path>) -> anyhow::Result<()> {
    let racine = crate::racine_jeu(game_dir);
    let data = racine.join("data");
    let cpk_list = data.join("cpk_list.cfg.bin");
    let sauvegarde = chemin_sauvegarde(&cpk_list);
    if !sauvegarde.is_file() {
        bail!(
            "aucune sauvegarde à « {} » — rien à restaurer (le mod n'a pas été installé par \
             `niers mod install`)",
            sauvegarde.display()
        );
    }
    let vanilla = std::fs::read(&sauvegarde)?;
    std::fs::write(&cpk_list, &vanilla)?;
    // Vérifier plutôt qu'affirmer : c'est bon marché, et « restauré » doit vouloir dire restauré.
    let relu = std::fs::read(&cpk_list)?;
    if relu != vanilla {
        bail!("la restauration n'a pas rendu les mêmes octets — le jeu est dans un état incertain");
    }
    println!(
        "restauré  {} ({} octets, identiques à la sauvegarde)",
        cpk_list.display(),
        relu.len()
    );

    if let Some(d) = dir {
        let fichiers = manifeste::fichiers(d).map_err(anyhow::Error::msg)?;
        let mut retires = 0usize;
        for f in &fichiers {
            let cible = racine.join(&f.vfs);
            if cible.is_file() && std::fs::remove_file(&cible).is_ok() {
                retires += 1;
            }
        }
        println!("retirés   {retires} fichier(s) du mod");
    } else {
        // Sans le cpk_list qui les référence, ces fichiers sont inertes : les laisser est le
        // choix sûr, les supprimer sans le demander ne l'est pas.
        println!("note      les fichiers du mod restent sur le disque, désormais inertes ;");
        println!("          `--dir <mod>` les retire aussi.");
    }
    std::fs::remove_file(&sauvegarde).ok();
    Ok(())
}
