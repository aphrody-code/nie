//! `niers icons` — index des **icônes du jeu** et extraction à la demande.
//!
//! ## Pourquoi un index et non un dossier de PNG
//!
//! Les atlas d'icônes du jeu pèsent des centaines de mégaoctets (plus de 5 000 conteneurs sous
//! `menu/200_icon/`, dont 4 195 pour les seuls portraits de personnages). Les décoder tous en PNG
//! produirait des dizaines de gigaoctets pour un contenu que `nie-model-serve` sait déjà rendre à
//! la demande — la route `/tex/<atlas>.g4tx/<region>.png` décode n'importe quelle région nommée.
//!
//! Cette commande produit donc l'**index** : pour chaque icône, son atlas, son rectangle et sa
//! taille. C'est ce qui manquait pour lister et chercher les icônes sans les matérialiser.
//!
//! ## Deux sorties
//!
//! - `index` écrit un JSON `{ "<nom>": { atlas, x, y, w, h } }` ;
//! - `extract` écrit les PNG d'un préfixe donné dans le dump disque, là où le CDN les sert en
//!   statique — utile pour les icônes affichées en permanence, pas pour le fonds entier.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use nie_formats::vfs::Vfs;
use serde_json::json;

/// Ce que `niers icons` sait faire.
#[derive(Debug, Clone, clap::Subcommand)]
pub enum IconsCmd {
    /// Écrit l'index des icônes (nom → atlas + rectangle) en JSON.
    Index {
        /// Préfixe VFS balayé.
        #[arg(long, default_value = "menu/200_icon/")]
        prefix: String,
        /// Familles écartées (sous-dossiers), séparées par des virgules.
        #[arg(long, default_value = "10_icon_chr,01_icon_emblem")]
        skip: String,
        /// Fichier de sortie.
        #[arg(short, long, default_value = "var/icons-index.json")]
        out: PathBuf,
    },
    /// Décode en PNG les icônes d'un préfixe, dans le dump disque servi par le CDN.
    Extract {
        /// Préfixe VFS des atlas à décoder.
        #[arg(long)]
        prefix: String,
        /// Nombre maximum d'icônes écrites.
        #[arg(long, default_value_t = 500)]
        limit: usize,
    },
}

/// Une icône localisée dans un atlas.
struct Icone {
    /// Chemin VFS de l'atlas.
    atlas: String,
    /// Nom de la texture principale à décoder.
    texture: String,
    /// Rectangle de la région, `None` si l'icône est une texture entière.
    rect: Option<(i16, i16, i16, i16)>,
    /// Dimensions rendues.
    taille: (i32, i32),
}

/// Balaie les atlas sous `prefix` et indexe leurs textures et régions nommées.
fn indexer(vfs: &Vfs, prefix: &str, skip: &[String]) -> BTreeMap<String, Icone> {
    let mut out: BTreeMap<String, Icone> = BTreeMap::new();
    let chemins: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p.to_string())
        .filter(|p| {
            p.contains(prefix) && p.ends_with(".g4tx") && !skip.iter().any(|s| p.contains(s.as_str()))
        })
        .collect();
    for chemin in chemins {
        let Ok(raw) = vfs.read(&chemin) else { continue };
        let Ok(tx) = nie_formats::g4tx::parse(&raw) else { continue };
        for tex in &tx.textures {
            // Les placeholders du jeu (`dmy`, 4×4) ne sont pas des icônes.
            if tex.name.contains("dmy") || (tex.width <= 4 && tex.height <= 4) {
                continue;
            }
            out.entry(tex.name.clone()).or_insert(Icone {
                atlas: chemin.clone(),
                texture: tex.name.clone(),
                rect: None,
                taille: (tex.width, tex.height),
            });
            for sub in &tex.sub_textures {
                if sub.name.contains("dmy") || sub.width <= 4 {
                    continue;
                }
                out.entry(sub.name.clone()).or_insert(Icone {
                    atlas: chemin.clone(),
                    texture: tex.name.clone(),
                    rect: Some((sub.x, sub.y, sub.width, sub.height)),
                    taille: (i32::from(sub.width), i32::from(sub.height)),
                });
            }
        }
    }
    out
}

/// Point d'entrée de `niers icons`.
pub fn run(cmd: &IconsCmd, game_dir: &Path) -> Result<()> {
    let mut vfs = Vfs::new();
    vfs.init(game_dir.join("data")).context("init VFS")?;

    match cmd {
        IconsCmd::Index { prefix, skip, out } => {
            let skip: Vec<String> =
                skip.split(',').filter(|s| !s.is_empty()).map(str::to_string).collect();
            let index = indexer(&vfs, prefix, &skip);
            let doc: BTreeMap<&String, serde_json::Value> = index
                .iter()
                .map(|(nom, i)| {
                    (
                        nom,
                        json!({
                            "atlas": i.atlas,
                            "texture": i.texture,
                            "rect": i.rect.map(|(x, y, w, h)| json!([x, y, w, h])),
                            "w": i.taille.0,
                            "h": i.taille.1,
                            // URL servie par le CDN : le décodage se fait à la demande, et la
                            // route rogne la région quand le nom en désigne une — d'où le nom de
                            // l'icône dans l'URL, pas celui de la texture porteuse.
                            "url": format!(
                                "/tex/{}/{}.png",
                                i.atlas.trim_start_matches("data/"),
                                nom
                            ),
                        }),
                    )
                })
                .collect();
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            std::fs::write(out, serde_json::to_vec_pretty(&doc)?)
                .with_context(|| format!("écriture {}", out.display()))?;
            println!("indexé {} icônes → {}", index.len(), out.display());
        }

        IconsCmd::Extract { prefix, limit } => {
            let index = indexer(&vfs, prefix, &[]);
            let mut ecrits = 0usize;
            let mut echecs = 0usize;
            for (nom, ic) in index.iter().take(*limit) {
                let Ok(raw) = vfs.read(&ic.atlas) else {
                    echecs += 1;
                    continue;
                };
                // Le nom de l'ICÔNE, pas celui de sa texture porteuse : `decode_named_to_png`
                // rogne le rectangle de la région quand le nom en désigne une. Passer la texture
                // écrivait l'atlas entier sous chaque nom d'icône — 592 Ko par icône de 80×80.
                let Some(png) = nie_formats::g4tx_decode::decode_named_to_png(&raw, nom)
                else {
                    echecs += 1;
                    continue;
                };
                // À côté de l'atlas dans le dump, là où le CDN sert `/dx11/…` en statique.
                let dossier = game_dir.join(
                    Path::new(&ic.atlas).parent().and_then(Path::to_str).unwrap_or("data"),
                );
                if std::fs::create_dir_all(&dossier).is_err() {
                    echecs += 1;
                    continue;
                }
                if std::fs::write(dossier.join(format!("{nom}.png")), png).is_ok() {
                    ecrits += 1;
                } else {
                    echecs += 1;
                }
            }
            println!("{ecrits} PNG écrits, {echecs} échec(s) — {} indexées", index.len());
        }
    }
    Ok(())
}
