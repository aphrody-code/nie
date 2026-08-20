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
use nie_formats::cfgbin;
use nie_formats::vfs::Vfs;
use serde_json::json;

/// Lit un dictionnaire `clé → valeur` existant, ou rend une table vide s'il est absent.
///
/// L'absence n'est pas une erreur : le dictionnaire se reconstruit. Un fichier illisible non plus —
/// mais il ne doit pas être écrasé en silence, d'où le message.
fn charger_map(chemin: &Path) -> BTreeMap<String, String> {
    match std::fs::read_to_string(chemin) {
        Ok(txt) => match serde_json::from_str(&txt) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("  ({} illisible : {e} — reparti de zéro)", chemin.display());
                BTreeMap::new()
            }
        },
        Err(_) => BTreeMap::new(),
    }
}

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
    /// Écrit les deux dictionnaires que le rendu de menu consomme pour rogner ses sprites.
    ///
    /// Le layout runtime d'un écran ne connaît d'une région que son **hachage** ; la chaîne de
    /// résolution (`nie-game`, `cmd_export_layout_runtime`) fait hachage → nom → atlas → rectangle.
    /// Le premier maillon manque pour tout ce qui n'apparaît pas dans le corpus Lua : les noms de
    /// région vivent dans les `.g4tx`, pas dans les scripts. Sans eux, le sprite est blité en
    /// **atlas entier** au lieu du rectangle — 2640×1364 à la place d'une icône de 56×56.
    Dict {
        /// Préfixe VFS balayé.
        #[arg(long, default_value = "menu/")]
        prefix: String,
        /// Familles écartées (sous-dossiers), séparées par des virgules.
        #[arg(long, default_value = "")]
        skip: String,
        /// Répertoire des dictionnaires de reverse.
        #[arg(long, default_value = "data/re")]
        out_dir: PathBuf,
        /// N'écrit rien : dit seulement ce que la fusion ajouterait.
        #[arg(long)]
        dry_run: bool,
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

        IconsCmd::Dict { prefix, skip, out_dir, dry_run } => {
            let skip: Vec<String> =
                skip.split(',').filter(|s| !s.is_empty()).map(str::to_string).collect();
            let index = indexer(&vfs, prefix, &skip);

            let chemin_crc = out_dir.join("menu-crc32-dictionary.json");
            let chemin_reg = out_dir.join("menu-region-index.json");
            let mut crc: BTreeMap<String, String> = charger_map(&chemin_crc);
            let mut reg: BTreeMap<String, String> = charger_map(&chemin_reg);
            let (crc_avant, reg_avant) = (crc.len(), reg.len());

            // Une collision de hachage est une information, pas un détail à écraser en silence :
            // deux noms distincts pour un même CRC-32 rendraient la résolution ambiguë.
            let mut collisions = 0usize;
            for (nom, ic) in &index {
                let cle = format!("0x{:08X}", cfgbin::crc32(nom.as_bytes()));
                match crc.get(&cle) {
                    Some(deja) if deja != nom => collisions += 1,
                    Some(_) => {}
                    None => {
                        crc.insert(cle, nom.clone());
                    }
                }
                reg.entry(nom.clone()).or_insert_with(|| ic.atlas.clone());
            }

            println!(
                "{} noms de région balayés sous « {prefix} »\n  \
                 crc32   {crc_avant} → {crc_apres} (+{crc_delta})\n  \
                 régions {reg_avant} → {reg_apres} (+{reg_delta})\n  \
                 collisions de hachage : {collisions}",
                index.len(),
                crc_apres = crc.len(),
                crc_delta = crc.len() - crc_avant,
                reg_apres = reg.len(),
                reg_delta = reg.len() - reg_avant,
            );
            if *dry_run {
                println!("  (--dry-run : rien écrit)");
                return Ok(());
            }
            std::fs::create_dir_all(out_dir).ok();
            std::fs::write(&chemin_crc, serde_json::to_vec_pretty(&crc)?)
                .with_context(|| format!("écriture {}", chemin_crc.display()))?;
            std::fs::write(&chemin_reg, serde_json::to_vec_pretty(&reg)?)
                .with_context(|| format!("écriture {}", chemin_reg.display()))?;
            println!("  écrits : {} · {}", chemin_crc.display(), chemin_reg.display());
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
