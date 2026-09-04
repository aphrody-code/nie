//! Accès au **code du dépôt** depuis l'app desktop — façade Tauri sur `nie_explore::depot`.
//!
//! L'explorateur savait tout montrer du jeu (VFS, modèles, textures, sauvegardes, forge) et
//! rien du dépôt qui le produit. Ces quatre commandes comblent ce manque en réutilisant le
//! moteur déjà partagé par `niers find`/`grep` et par le serveur MCP `niers-game` : le
//! confinement, les plafonds et les exclusions de dossiers ne sont écrits qu'une fois.
//!
//! Toutes les commandes sont `async` : elles touchent au disque, et une commande
//! `#[tauri::command]` synchrone s'exécute sur le THREAD PRINCIPAL — ce qui fige l'IPC et,
//! si un `tokio::spawn` s'y glisse, abat l'application sans trace utile (cf. `CLAUDE.md`).

use nie_explore::depot::{Depot, OptionsParcours};
use serde::Serialize;

/// Un fichier du dépôt, lu ou décrit.
#[derive(Serialize, specta::Type)]
pub struct FichierDepotDto {
    /// Chemin relatif à la racine du dépôt, séparateurs `/`.
    pub chemin: String,
    /// Taille totale du fichier en octets.
    pub taille: u32,
    /// Vrai si le contenu s'arrête avant la fin du fichier.
    pub tronque: bool,
    /// Vrai si le fichier est binaire ; le contenu n'est alors pas renvoyé.
    pub binaire: bool,
    /// Contenu textuel, absent pour un binaire ou au-delà du plafond.
    pub contenu: Option<String>,
    /// Explication lisible quand le contenu manque.
    pub note: Option<String>,
}

/// Une entrée de dossier du dépôt.
#[derive(Serialize, specta::Type)]
pub struct EntreeDepotDto {
    /// Chemin relatif à la racine du dépôt.
    pub chemin: String,
    /// Nom seul de l'entrée.
    pub nom: String,
    /// Vrai pour un dossier.
    pub dossier: bool,
    /// Taille en octets (0 pour un dossier).
    pub taille: u32,
}

/// Une ligne trouvée par [`depot_chercher`].
#[derive(Serialize, specta::Type)]
pub struct CorrespondanceDto {
    /// Chemin relatif à la racine du dépôt.
    pub chemin: String,
    /// Numéro de ligne, à partir de 1.
    pub ligne: u32,
    /// Texte de la ligne, sans le saut de ligne final.
    pub texte: String,
}

/// Remonte jusqu'à un ancêtre qui ressemble à la racine du dépôt niers.
///
/// Marqueur retenu : un `Cargo.toml` **et** un dossier `crates/`. `forge/registry.json` (celui
/// qu'utilise le module `forge`) ne conviendrait pas : il n'existe qu'une fois la forge lancée,
/// alors que le code, lui, est toujours là.
fn racine_depot(racine: Option<String>) -> Result<std::path::PathBuf, String> {
    let depart = match racine {
        Some(r) if !r.trim().is_empty() => std::path::PathBuf::from(r),
        _ => std::env::current_dir().map_err(|e| e.to_string())?,
    };
    let mut cur = Some(depart.as_path());
    while let Some(dir) = cur {
        if dir.join("Cargo.toml").is_file() && dir.join("crates").is_dir() {
            return Ok(dir.to_path_buf());
        }
        cur = dir.parent();
    }
    Err(format!(
        "racine du dépôt niers introuvable depuis {} — indiquer son chemin",
        depart.display()
    ))
}

/// Ouvre le dépôt à la racine résolue.
fn ouvrir(racine: Option<String>) -> Result<Depot, String> {
    let r = racine_depot(racine)?;
    Depot::ouvrir(r).map_err(|e| e.to_string())
}

/// Traduit les arguments d'IPC en options de parcours.
fn options(
    sous_dossier: Option<String>,
    extensions: Option<Vec<String>>,
    globs: Option<Vec<String>>,
    limite: Option<u32>,
    sensible_casse: Option<bool>,
) -> OptionsParcours {
    OptionsParcours {
        sous_dossier: sous_dossier.unwrap_or_default(),
        globs: globs.unwrap_or_default(),
        extensions: extensions.unwrap_or_default(),
        caches: false,
        sans_ignore: false,
        profondeur: None,
        limite: limite.unwrap_or(200) as usize,
        sensible_casse: sensible_casse.unwrap_or(false),
    }
}

/// Lit un fichier texte du dépôt.
///
/// `max_octets` plafonne la lecture (défaut 256 Kio, plafond dur 8 Mio).
#[tauri::command]
#[specta::specta]
pub async fn depot_lire(
    racine: Option<String>,
    chemin: String,
    max_octets: Option<u32>,
) -> Result<FichierDepotDto, String> {
    tokio::task::spawn_blocking(move || {
        let d = ouvrir(racine)?;
        let f = d
            .lire(&chemin, max_octets.map(u64::from))
            .map_err(|e| e.to_string())?;
        Ok(FichierDepotDto {
            chemin: f.chemin,
            taille: u32::try_from(f.taille).unwrap_or(u32::MAX),
            tronque: f.tronque,
            binaire: f.binaire,
            contenu: f.contenu,
            note: f.note,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Liste les entrées immédiates d'un dossier du dépôt (dossiers d'abord).
#[tauri::command]
#[specta::specta]
pub async fn depot_lister(
    racine: Option<String>,
    chemin: Option<String>,
) -> Result<Vec<EntreeDepotDto>, String> {
    tokio::task::spawn_blocking(move || {
        let d = ouvrir(racine)?;
        let entrees = d
            .lister(&chemin.unwrap_or_default())
            .map_err(|e| e.to_string())?;
        Ok(entrees
            .into_iter()
            .map(|e| EntreeDepotDto {
                chemin: e.chemin,
                nom: e.nom,
                dossier: e.dossier,
                taille: u32::try_from(e.taille).unwrap_or(u32::MAX),
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cherche des fichiers du dépôt par sous-chaîne de chemin.
#[tauri::command]
#[specta::specta]
pub async fn depot_trouver(
    racine: Option<String>,
    motif: String,
    sous_dossier: Option<String>,
    extensions: Option<Vec<String>>,
    globs: Option<Vec<String>>,
    limite: Option<u32>,
    sensible_casse: Option<bool>,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let d = ouvrir(racine)?;
        let o = options(sous_dossier, extensions, globs, limite, sensible_casse);
        d.trouver(&motif, &o).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cherche une expression régulière dans le contenu des fichiers du dépôt.
#[tauri::command]
#[specta::specta]
pub async fn depot_chercher(
    racine: Option<String>,
    motif: String,
    sous_dossier: Option<String>,
    extensions: Option<Vec<String>>,
    globs: Option<Vec<String>>,
    limite: Option<u32>,
    sensible_casse: Option<bool>,
) -> Result<Vec<CorrespondanceDto>, String> {
    tokio::task::spawn_blocking(move || {
        let d = ouvrir(racine)?;
        let o = options(sous_dossier, extensions, globs, limite, sensible_casse);
        let hits = d.chercher(&motif, &o).map_err(|e| e.to_string())?;
        Ok(hits
            .into_iter()
            .map(|c| CorrespondanceDto {
                chemin: c.chemin,
                ligne: u32::try_from(c.ligne).unwrap_or(u32::MAX),
                texte: c.texte,
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
