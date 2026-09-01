//! `niers avatar` — l'**éditeur d'avatar** (`chara_edit`) résolu de bout en bout.
//!
//! ## Ce que la commande relie
//!
//! Le catalogue de l'éditeur vit dans deux `cfg.bin` de `gamedata/character/` et trois `cfg.bin`
//! posés **à côté des modèles**, dans `chr/_face/20_EDIT/`. Aucun ne se suffit :
//!
//! | fichier | ce qu'il apporte |
//! |---|---|
//! | `chara_edit_<ver>.cfg.bin` | 16 listes : parts, curseurs, couleurs, voix, recettes de presets |
//! | `chara_edit_parts_type_config_<ver>.cfg.bin` | modèles de base par morphologie (visage, accessoires) |
//! | `20_EDIT/center.cfg.bin` | centre `(u, v, w, h)` de chaque texture de part dans l'atlas de visage |
//! | `20_EDIT/texPartsDefaultPose.cfg.bin` | pose par défaut (translation/échelle) de chaque part |
//! | `20_EDIT/editCharaMdlParts.cfg.bin` | règles de modèle : décalage de visage, oreilles masquées par les cheveux |
//!
//! ## Les trois familles de hachage, et ce qu'elles désignent vraiment
//!
//! Tout est CRC-32 (`nie_formats::cfgbin::crc32`), mais les cibles diffèrent — et le nom des
//! champs induit en erreur :
//!
//! - `resourceName1` / `resourceName2` → **modèle 3D** du VFS (`hairF001` → `_hairF/hairF001.g4md`
//!   + `.g4mg`). C'est aussi la clé des tables de pose de `20_EDIT`.
//! - `textureName` → **pas** une texture de modèle : l'**icône d'interface** de la vignette dans
//!   la grille de l'éditeur (`icon_ava_face06_004`), résolue par `hash_name` de la base de
//!   connaissance (source `vfs-ui`, cf. `niers seed-ui`).
//! - `presetID` d'une recette → le hash du nom d'une part de la catégorie « preset »
//!   (`preset_01_normal`) : le même identifiant est à la fois une vignette sélectionnable et une
//!   recette de 62 à 72 lignes.
//!
//! Les libellés de catégorie ne sont **pas** inventés ici : ils sont dérivés du plus long préfixe
//! commun des noms de ressources de la catégorie, tels qu'ils apparaissent dans les fichiers.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result};
use nie_data::chara_edit::{parse_chara_edit, parse_chara_edit_parts_type_config, CharaEditConfig};
use nie_formats::cfgbin;
use nie_formats::vfs::Vfs;
use serde_json::{json, Value as Json};

/// Racine des assets de l'éditeur dans le VFS.
const EDIT_ROOT: &str = "chr/_face/20_EDIT/";

/// Les sept statistiques du jeu, dans l'ordre horaire du radar de l'écran de statistiques.
///
/// Ces hachages sont ceux de `menu_text` — les libellés sont donc traduits comme le reste. Ils ne
/// viennent pas du pool de constantes de `chara_edit` : cet écran-là emprunte les libellés de
/// statistiques communs au jeu, et l'ordre ci-dessous est celui que les captures montrent autour
/// du radar (frappe en haut, puis dans le sens horaire). C'est la seule liste de ce module dont
/// l'appartenance à l'écran vient d'une capture et non d'un fichier de l'éditeur.
const STATS_RADAR: [u32; 7] = [
    0x9676_CFF2, // Frappe
    0xBF19_862F, // Contrôle
    0x5E95_B812, // Pression
    0xA9F1_F72B, // Physique
    0xE0F2_0046, // Agilité
    0xAC95_CB90, // Intelligence
    0xD02A_224B, // Technique
];



/// Écran de l'éditeur correspondant à une catégorie, par **rapprochement lexical**.
///
/// Les écrans du jeu s'appellent `chara_edit_parts_menu_<quoi>` (`_eye`, `_mouth`, `_eyebrow`,
/// `_ear`, `_hair`, `_nose`, `_contour`, `_preset`…) et chaque catégorie porte un préfixe de
/// ressources (`eye_`, `mouth_`, `eyebrow_`, `hairF`…). Quand l'un contient l'autre, le lien est
/// mécanique — aucune table écrite à la main, et rien n'est rendu quand aucun nom ne concorde.
fn ecran_de_categorie(prefixe: &str, ecrans: &[String]) -> Option<String> {
    let socle = prefixe.trim_end_matches(|c: char| c == '_' || c.is_ascii_digit());
    if socle.len() < 3 {
        return None;
    }
    let socle = socle.to_ascii_lowercase();
    // Correspondance STRICTE. Une simple sous-chaîne rapprochait `ear` de
    // `..._status_ability_learning` et `eye_` de `..._eye_highlight_list` : la queue d'écran doit
    // donc valoir le socle, éventuellement suivie d'un suffixe de vue (`_list`).
    // 1) égalité du noyau, 2) à défaut, le socle COMMENCE par le noyau (`hairF` → `_hair`).
    // Un préfixe, jamais une sous-chaîne libre : `ear` ne commence pas par `learning`.
    let candidats = |exact: bool| {
        ecrans
            .iter()
            .filter_map(|e| {
                let queue = e.strip_prefix("chara_edit_parts_menu_")?;
                let noyau = queue.strip_suffix("_list").unwrap_or(queue);
                let ok = if exact { noyau == socle } else { socle.starts_with(noyau) };
                ok.then(|| (noyau.len(), e.clone()))
            })
            .max_by_key(|(n, _)| *n)
            .map(|(_, e)| e)
    };
    candidats(true).or_else(|| candidats(false))
}

/// Géométrie de la grille d'une palette, déduite de son nombre de couleurs.
///
/// Le jeu nomme ses écrans de palette par leur grille — `chara_edit_color_menu_10x4_skin`,
/// `_12x5`, `_13x5` — et le compte de couleurs de chaque palette tombe exactement dessus :
/// 40 = 10×4 (peau), 60 = 12×5 (œil), 65 = 13×5 (cheveux). La géométrie n'est donc pas devinée,
/// elle est recoupée par deux sources indépendantes. Les autres tailles rendent `None` plutôt
/// qu'une disposition inventée.
fn geometrie_palette(n: usize) -> Option<(usize, usize)> {
    match n {
        40 => Some((10, 4)),
        60 => Some((12, 5)),
        65 => Some((13, 5)),
        _ => None,
    }
}

/// Une image décodée : largeur, hauteur, octets RGBA.
type Rgba = (u32, u32, Vec<u8>);

/// Collecte, dans l'ordre, les constantes numériques d'un prototype Lua et de ses imbriqués.
fn constantes_num(proto: &nie_lua::bytecode::Prototype, out: &mut Vec<u32>) {
    for c in &proto.constants {
        if let nie_lua::bytecode::Constant::Number(n) = c {
            // Les hachages sont stockés en `double` : seuls les entiers exacts qui tiennent sur
            // 32 bits peuvent en être un.
            if n.fract() == 0.0 && *n >= 0.0 && *n <= f64::from(u32::MAX) {
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                out.push(*n as u32);
            } else {
                out.push(0);
            }
        } else {
            out.push(0);
        }
    }
    for p in &proto.protos {
        constantes_num(p, out);
    }
}

/// Les **rubriques de l'éditeur**, dans l'ordre où le jeu les affiche.
///
/// Le script de l'écran de liste (`chara_edit_list_menu`) porte, dans son pool de constantes,
/// une **suite contiguë** de hachages de libellés — et cette suite est l'ordre de la colonne de
/// gauche de l'éditeur. On la retrouve mécaniquement : la plus longue séquence consécutive de
/// constantes numériques qui sont toutes des clés de `menu_text`.
///
/// Ce que cela donne, et ce que cela ne donne pas : l'**ordre** et les **libellés** sont établis ;
/// l'association d'une rubrique à un `faceSettingType` précis, elle, ne l'est pas — c'est le code
/// du menu qui la fait, et le driver Lua du dépôt n'apparie aucun objet sur cet écran. Aucune
/// correspondance n'est donc inventée ici.
fn rubriques(vfs: &Vfs, textes: &BTreeMap<u32, String>) -> Vec<(u32, String)> {
    let Some(chemin) = vfs.iter().map(|(p, _)| p.to_string()).find(|p| {
        p.rsplit('/')
            .next()
            .is_some_and(|b| b.starts_with("chara_edit_list_menu") && b.ends_with(".lua.bin"))
    }) else {
        return Vec::new();
    };
    let Ok(octets) = vfs.read(&chemin) else { return Vec::new() };
    let Ok(chunk) = nie_lua::bytecode::parse(&octets) else { return Vec::new() };

    let mut nums = Vec::new();
    constantes_num(&chunk.main, &mut nums);

    // Plus longue plage consécutive de hachages connus de `menu_text`.
    let (mut meilleur_debut, mut meilleure_len) = (0usize, 0usize);
    let (mut debut, mut len) = (0usize, 0usize);
    for (i, h) in nums.iter().enumerate() {
        if *h != 0 && textes.contains_key(h) {
            if len == 0 {
                debut = i;
            }
            len += 1;
            if len > meilleure_len {
                (meilleur_debut, meilleure_len) = (debut, len);
            }
        } else {
            len = 0;
        }
    }
    if meilleure_len < 3 {
        return Vec::new();
    }
    nums[meilleur_debut..meilleur_debut + meilleure_len]
        .iter()
        .map(|h| (*h, textes.get(h).cloned().unwrap_or_default()))
        .collect()
}

/// Un **panneau de l'éditeur** : un script d'écran et les libellés qu'il affiche, dans l'ordre.
struct Panneau {
    /// Nom de base du script, sans la version ni `.lua.bin` (`chara_edit_parts_menu_contour`).
    nom: String,
    /// Libellés résolus dans `menu_text`, dans l'ordre du pool de constantes du script :
    /// `(hash, texte affichable, gaiji du libellé)` — cf. `nie_data::text::split_markup`.
    libelles: Vec<(u32, String, Vec<String>)>,
}

/// Les libellés de **chaque panneau** de l'éditeur, dans l'ordre du script qui les affiche.
///
/// Même mécanique que [`rubriques`], appliquée à tous les scripts `chara_edit*` : le pool de
/// constantes d'un script d'écran porte les hachages des libellés que cet écran pose, et l'ordre du
/// pool est celui de leur première apparition dans le code — donc l'ordre d'affichage. On ne garde
/// que les hachages qui sont des clés de `menu_text` : une constante numérique quelconque (un
/// index, une couleur) n'en est pas une, et la collision est improbable sur 32 bits.
///
/// Contrairement à [`rubriques`], **aucune contiguïté n'est exigée** : un panneau mêle ses libellés
/// à ses constantes de mise en page. En retour, l'ordre est celui du pool et non celui du dessin —
/// il ne prouve pas la position d'un libellé à l'écran, seulement son appartenance au panneau.
fn panneaux(vfs: &Vfs, textes: &BTreeMap<u32, String>) -> Vec<Panneau> {
    let mut chemins: Vec<String> = vfs
        .iter()
        .filter_map(|(p, _)| {
            let base = p.rsplit('/').next()?;
            (base.starts_with("chara_edit") && base.ends_with(".lua.bin")).then(|| p.to_string())
        })
        .collect();
    chemins.sort();
    chemins.dedup();

    let mut out = Vec::new();
    for chemin in chemins {
        let Ok(octets) = vfs.read(&chemin) else { continue };
        let Ok(chunk) = nie_lua::bytecode::parse(&octets) else { continue };
        let mut nums = Vec::new();
        constantes_num(&chunk.main, &mut nums);

        let mut vus = std::collections::BTreeSet::new();
        let libelles: Vec<(u32, String, Vec<String>)> = nums
            .into_iter()
            .filter(|h| *h != 0 && textes.contains_key(h) && vus.insert(*h))
            .map(|h| {
                let brut = textes.get(&h).cloned().unwrap_or_default();
                let (texte, gaiji) = nie_data::text::split_markup(&brut);
                (h, texte, gaiji)
            })
            .collect();
        if libelles.is_empty() {
            continue;
        }
        // `chara_edit_parts_menu_contour_1.03.71.00.lua.bin` → `chara_edit_parts_menu_contour`.
        let base = chemin.rsplit('/').next().unwrap_or(&chemin);
        let sans_ext = base.strip_suffix(".lua.bin").unwrap_or(base);
        let nom = match sans_ext.rsplit_once('_') {
            Some((tete, queue)) if queue.chars().next().is_some_and(|c| c.is_ascii_digit()) => tete,
            _ => sans_ext,
        };
        out.push(Panneau { nom: nom.to_string(), libelles });
    }
    out
}

/// Fragments de nom qui désignent un contenu que le dépôt ne reproduit pas encore.
const MOTIFS_DYNAMIQUES: [&str; 4] = ["model", "chara_3d", "cursor", "shadow"];

/// `niers avatar roi` — dérive les régions de mesure d'un écran depuis son layout.
fn roi(ecran: &str, layouts: &Path, out: Option<&Path>) -> Result<()> {
    let chemin = layouts.join(format!("{ecran}.json"));
    let txt = std::fs::read_to_string(&chemin)
        .with_context(|| format!("lecture {}", chemin.display()))?;
    let doc: Json = serde_json::from_str(&txt)
        .with_context(|| format!("layout invalide : {}", chemin.display()))?;
    let (cw, ch) = (
        doc["canvas"]["w"].as_f64().unwrap_or(1280.0),
        doc["canvas"]["h"].as_f64().unwrap_or(720.0),
    );

    let mut rois: Vec<Json> = Vec::new();
    let mut non_derivables: Vec<String> = Vec::new();

    for o in doc["objects"].as_array().map(Vec::as_slice).unwrap_or_default() {
        let nom = o["name"].as_str().unwrap_or_default();
        let bas = nom.to_ascii_lowercase();
        if !MOTIFS_DYNAMIQUES.iter().any(|m| bas.contains(m)) {
            continue;
        }
        let (sw, sh) = (o["sprite"]["w"].as_f64(), o["sprite"]["h"].as_f64());
        let t = &o["transform"];
        let (sx, sy) = (t["scaleX"].as_f64().unwrap_or(1.0), t["scaleY"].as_f64().unwrap_or(1.0));
        let (x, y) = (t["x"].as_f64().unwrap_or(0.0), t["y"].as_f64().unwrap_or(0.0));

        // Signature du repli documenté : sprite factice, ou objet parqué au centre exact à
        // l'échelle native. Dans les deux cas la géométrie du layout ne décrit PAS ce que la
        // capture montre — l'avatar y occupe une large zone centrale, pas un carré de 4 px.
        let factice = sw.unwrap_or(0.0) <= 8.0 || sh.unwrap_or(0.0) <= 8.0;
        let parque = (sx - 1.0).abs() < 1e-6
            && (sy - 1.0).abs() < 1e-6
            && (x - cw / 2.0).abs() < 0.5
            && (y - ch / 2.0).abs() < 0.5;
        if factice || parque {
            non_derivables.push(String::from(nom));
            continue;
        }

        let (Some(sw), Some(sh)) = (sw, sh) else { continue };
        let (bw, bh) = (sw * sx, sh * sy);
        let (bx, by) = ((x - bw / 2.0).max(0.0), (y - bh / 2.0).max(0.0));
        rois.push(json!({
            "nom": nom,
            "rect": [bx.round() as i64, by.round() as i64, bw.round() as i64, bh.round() as i64],
            "kind": "dynamique",
        }));
    }

    println!("{ecran} : {} région(s) dérivée(s) du layout", rois.len());
    for r in &rois {
        println!("  {} {:?}", r["nom"].as_str().unwrap_or(""), r["rect"]);
    }
    if !non_derivables.is_empty() {
        non_derivables.sort_unstable();
        non_derivables.dedup();
        println!(
            "  {} objet(s) dynamique(s) SANS géométrie exploitable — aucune région produite pour eux :",
            non_derivables.len()
        );
        for n in &non_derivables {
            println!("    {n}");
        }
        println!(
            "  Ces objets sont des emplacements 3D : le layout leur donne un sprite factice posé au\n  \
             centre. Leur étendue réelle n'est dans aucun fichier lu ici ; la mesure les compte donc\n  \
             encore, et le rapport de `niers img diff` l'annonce par une surface exclue plus faible."
        );
    }

    if let Some(out) = out {
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(out, serde_json::to_vec_pretty(&Json::Array(rois))?)
            .with_context(|| format!("écriture {}", out.display()))?;
        println!("  écrit : {}", out.display());
    }
    Ok(())
}

/// Famille d'une planche : le premier segment de chemin qui suit le préfixe balayé.
///
/// `…/_facetex/04_eyebrow/eyebrow_00.g4tx` sous le préfixe `…/_facetex/` donne `04_eyebrow`. Une
/// planche posée directement sous le préfixe n'a pas de famille et se range sous `.`.
fn famille_de(chemin: &str, prefix: &str) -> String {
    let reste = chemin.split(prefix).nth(1).unwrap_or(chemin);
    match reste.split_once('/') {
        Some((dossier, _)) => dossier.to_string(),
        None => ".".to_string(),
    }
}

/// Rend une part en pourcentage à deux décimales, séparateur français.
fn pct(part: f32) -> String {
    format!("{:.2} %", part * 100.0).replace('.', ",")
}

/// Rend une emprise normalisée `u[a;b] v[c;d]`, ou `—` si la zone est vide.
fn fmt_emprise(e: Option<[f32; 4]>) -> String {
    e.map_or_else(
        || "—".to_string(),
        |[u0, v0, u1, v1]| format!("u[{u0:.3};{u1:.3}] v[{v0:.3};{v1:.3}]").replace('.', ","),
    )
}

/// Mesures d'une planche en JSON, telles que [`nie_formats::planche::Mesures`] les porte.
fn mesures_json(m: &nie_formats::planche::Mesures) -> Json {
    use nie_formats::planche::Zone;
    let zones: serde_json::Map<String, Json> = Zone::toutes()
        .into_iter()
        .map(|z| {
            (
                z.nom().to_string(),
                json!({
                    "part": m.part(z),
                    "emprise": m.emprise(z).map(Vec::from),
                }),
            )
        })
        .collect();
    json!({
        "largeur": m.largeur,
        "hauteur": m.hauteur,
        "pixels": m.pixels,
        "zones": zones,
        "part_encre": m.part_encre,
        "emprise_encre": m.emprise_encre.map(Vec::from),
        "alpha_moyen": m.alpha_moyen,
        "alpha_min": m.alpha_min,
        "alpha_max": m.alpha_max,
        "canaux_constants": m.canaux_constants,
        "couleurs": m.couleurs,
        "couleurs_plafonnees": m.couleurs_plafonnees,
        "couleur_moyenne": m.couleur_moyenne,
    })
}

/// Côté de la grille d'occupation UV : 32 × 32 cases sur le carré `[0, 1]²`.
///
/// Assez fin pour distinguer un dépliage qui couvre tout le carré d'un autre qui n'en occupe qu'un
/// coin, assez grossier pour qu'une maille de quelques centaines de sommets remplisse ses cases.
const GRILLE_UV: usize = 32;

/// `niers avatar depliage` — dit quelle part du carré UV chaque sous-maille échantillonne.
///
/// C'est le chaînon manquant entre une planche et la maille qui la lit. Une planche se mesure
/// (cf. [`nie_formats::planche`]), une maille se déplie, et une composition n'est juste que si les
/// deux se recouvrent. Le rangement des familles par matériau — [`nie_formats::assemble::face_layer_slot`] —
/// repose sur des dépliages « disjoints » relevés une fois à la main ; cette commande les rend
/// régénérables.
///
/// Deux mesures par sous-maille, car la boîte englobante ment sur un dépliage épars : son
/// **emprise** (bornes u et v) et son **occupation**, la part des cases d'une grille
/// [`GRILLE_UV`] × [`GRILLE_UV`] qui portent au moins un sommet.
fn depliage(game_dir: &Path, modele: &str, limit: usize) -> Result<()> {
    let mut vfs = Vfs::new();
    vfs.init(game_dir.join("data")).context("init VFS")?;
    let mut chemins: Vec<String> = vfs
        .iter()
        .filter(|(p, _)| p.contains(EDIT_ROOT) && p.ends_with(".g4md") && p.contains(modele))
        .map(|(p, _)| p.to_string())
        .collect();
    chemins.sort();
    chemins.dedup();
    if chemins.is_empty() {
        println!("aucun .g4md sous {EDIT_ROOT} ne contient « {modele} »");
        return Ok(());
    }
    let total = chemins.len();
    chemins.truncate(limit);
    println!("{total} modèle(s), {} affiché(s)", chemins.len());

    for chemin in &chemins {
        let Ok(brut_md) = vfs.read(chemin) else { continue };
        let Ok(md) = nie_formats::g4md::parse(&brut_md) else {
            println!("  {} — g4md illisible", court(chemin));
            continue;
        };
        let chemin_mg = format!("{}.g4mg", chemin.trim_end_matches(".g4md"));
        let Ok(brut_mg) = vfs.read(&chemin_mg) else {
            println!("  {} — .g4mg absent", court(chemin));
            continue;
        };
        let geos = nie_formats::g4mg::extract_geometry(&brut_mg, &md);
        println!("  {} — {} sous-maille(s)", court(chemin), geos.len());
        for geo in &geos {
            let materiau = nie_formats::g4mg::material_base_name(&md, geo)
                .map_or("(sans nom)", String::as_str);
            if geo.uv0.is_empty() {
                println!("    #{} {materiau:<18} {:>6} som.  aucun UV0", geo.index, geo.vertex_count);
                continue;
            }
            let (mut u0, mut v0, mut u1, mut v1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
            let mut cases = alloc_grille();
            for uv in &geo.uv0 {
                if !uv.u.is_finite() || !uv.v.is_finite() {
                    continue;
                }
                u0 = u0.min(uv.u);
                v0 = v0.min(uv.v);
                u1 = u1.max(uv.u);
                v1 = v1.max(uv.v);
                // Un UV hors [0, 1] est licite (répétition) : on le replie pour l'occupation, sans
                // toucher à l'emprise, qui doit dire la vérité y compris quand elle déborde.
                let cx = ((uv.u.rem_euclid(1.0)) * GRILLE_UV as f32) as usize;
                let cy = ((uv.v.rem_euclid(1.0)) * GRILLE_UV as f32) as usize;
                cases[cy.min(GRILLE_UV - 1) * GRILLE_UV + cx.min(GRILLE_UV - 1)] = true;
            }
            let occupees = cases.iter().filter(|c| **c).count();
            println!(
                "    #{} {materiau:<18} {:>6} som.  u[{u0:.3};{u1:.3}] v[{v0:.3};{v1:.3}]  \
                 occupation {}",
                geo.index,
                geo.vertex_count,
                pct(occupees as f32 / (GRILLE_UV * GRILLE_UV) as f32)
            );
        }
    }
    Ok(())
}

/// Grille d'occupation vide.
fn alloc_grille() -> Vec<bool> {
    vec![false; GRILLE_UV * GRILLE_UV]
}

/// Écrit un tampon RGBA en PNG, éventuellement réduit à `cote` pixels de côté maximal.
fn ecrire_png(dir: &Path, nom: &str, w: u32, h: u32, rgba: &[u8], cote: u32) -> Result<()> {
    let (w, h, pixels) = if cote > 0 {
        nie_formats::image_out::reduire_rgba(rgba, w, h, cote)
            .map_err(|e| anyhow::anyhow!("réduction {nom} : {e}"))?
    } else {
        (w, h, rgba.to_vec())
    };
    let png = nie_formats::g4tx_decode::encode_rgba_to_png(&pixels, w as usize, h as usize)
        .with_context(|| format!("encodage PNG de {nom}"))?;
    std::fs::write(dir.join(nom), png).with_context(|| format!("écriture {nom}"))?;
    Ok(())
}

/// Écrit en PNG une planche, son masque, et le tracé que sa convention en tire.
///
/// Le tracé n'est **pas teinté** : la teinte par canaux dépend de la recette de couleurs choisie
/// dans l'éditeur, qui n'a rien à faire ici. Seul l'alpha vient de la convention, et c'est lui
/// qu'on cherche à voir — un sourcil se reconnaît à sa forme, pas à sa couleur.
///
/// Une planche muette n'a pas de tracé, et une convention indéterminée ne s'en invente pas : ces
/// deux cas n'écrivent que la couleur et le masque. Rend le nombre de fichiers écrits.
fn extraire_planche(
    dir: &Path,
    vfs: &Vfs,
    chemin: &str,
    famille: &str,
    fiche: &nie_formats::planche::Fiche,
    cote: u32,
) -> Result<usize> {
    use nie_formats::image_out;
    use nie_formats::planche::Convention;

    let brut = vfs.read(chemin).with_context(|| format!("lecture {chemin}"))?;
    let Some((w, h, rgba)) = nie_formats::g4tx_decode::decode_named_to_rgba(&brut, &fiche.nom)
    else {
        return Ok(0);
    };
    let masque = fiche
        .nom_masque
        .as_ref()
        .and_then(|nm| nie_formats::g4tx_decode::decode_named_to_rgba(&brut, nm))
        .map(|(_, _, m)| m);

    let base = format!("{famille}__{}", fiche.nom);
    let mut ecrits = 0usize;
    ecrire_png(dir, &format!("{base}.png"), w, h, &rgba, cote)?;
    ecrits += 1;
    if let Some(m) = &masque {
        ecrire_png(dir, &format!("{base}.msk.png"), w, h, m, cote)?;
        ecrits += 1;
    }

    let trace = match (fiche.convention, masque.as_ref()) {
        (Convention::FondRouge, Some(m)) => image_out::decouper_par_zones(w, h, &rgba, m),
        (Convention::TraceVert, Some(m)) => image_out::decouper_oeil(w, h, &rgba, m),
        (Convention::Decoupe, Some(m)) => {
            // Masque gris : son canal rouge EST l'opacité.
            let mut copie = rgba.clone();
            for i in (0..copie.len()).step_by(4) {
                copie[i + 3] = m[i];
            }
            Some(copie)
        }
        (Convention::SansMasque, _) => Some(rgba.clone()),
        _ => None,
    };
    if let Some(t) = trace {
        ecrire_png(dir, &format!("{base}.trace.png"), w, h, &t, cote)?;
        ecrits += 1;
    }
    Ok(ecrits)
}

/// Les options de `niers avatar planches`, telles que la ligne de commande les porte.
struct OptionsPlanches<'a> {
    /// Préfixe VFS balayé.
    prefix: &'a str,
    /// Fragment que le chemin doit contenir.
    filtre: Option<&'a str>,
    /// Détailler planche par planche.
    detail: bool,
    /// Fichier JSON du relevé complet.
    out: Option<&'a Path>,
    /// Répertoire d'extraction des PNG.
    extraire: Option<&'a Path>,
    /// Côté maximal des PNG extraits ; 0 = taille d'origine.
    vignette: u32,
    /// Nombre maximum de conteneurs analysés.
    limit: usize,
}

/// `niers avatar planches` — mesure les planches d'un préfixe du VFS et agrège par famille.
///
/// La commande **constate** : elle ne modifie aucune donnée du jeu. Son intérêt est le contraste —
/// une famille dont les 80 planches rendent la même convention justifie la règle codée pour elle,
/// une famille qui en rend deux dit que la règle par famille est fausse, et une planche muette
/// (ni tracé dans la couleur, ni forme dans le masque) explique une pièce absente du modèle sans
/// qu'il faille soupçonner le compositeur.
///
/// Avec `--extraire`, elle écrit aussi ce qu'elle a mesuré : la planche, son masque, et le tracé
/// que la convention en tire. C'est la seule façon de vérifier une convention autrement que sur
/// des pourcentages — un tracé de sourcil se reconnaît à l'œil, pas à ses 5,46 % de vert.
fn planches(game_dir: &Path, o: &OptionsPlanches) -> Result<()> {
    let &OptionsPlanches { prefix, filtre, detail, out, extraire, vignette, limit } = o;
    use nie_formats::planche::{self, Role, Zone};

    let mut vfs = Vfs::new();
    vfs.init(game_dir.join("data")).context("init VFS")?;
    let mut chemins: Vec<String> = vfs
        .iter()
        .filter(|(p, _)| p.contains(prefix) && p.ends_with(".g4tx"))
        .map(|(p, _)| p.to_string())
        .collect();
    chemins.sort();
    chemins.dedup();
    if let Some(f) = filtre {
        chemins.retain(|p| p.contains(f));
    }
    chemins.truncate(limit);
    println!(
        "{} conteneur(s) .g4tx sous {prefix}{}",
        chemins.len(),
        filtre.map_or(String::new(), |f| format!(" — filtre « {f} »"))
    );

    /// Ce qu'on retient d'une famille.
    #[derive(Default)]
    struct Agregat {
        conteneurs: usize,
        planches: usize,
        roles: BTreeMap<&'static str, usize>,
        conventions: BTreeMap<&'static str, usize>,
        muettes: Vec<String>,
    }

    let mut par_famille: BTreeMap<String, Agregat> = BTreeMap::new();
    let mut releve: Vec<Json> = Vec::new();
    let (mut illisibles, mut sans_planche, mut png_ecrits) = (0usize, 0usize, 0usize);

    for chemin in &chemins {
        let Ok(raw) = vfs.read(chemin) else {
            illisibles += 1;
            continue;
        };
        let fiches = planche::analyser(&raw);
        if fiches.is_empty() {
            sans_planche += 1;
            continue;
        }
        let famille = famille_de(chemin, prefix);
        let agr = par_famille.entry(famille.clone()).or_default();
        agr.conteneurs += 1;

        for f in &fiches {
            agr.planches += 1;
            *agr.roles.entry(f.role.nom()).or_default() += 1;
            *agr.conventions.entry(f.convention.nom()).or_default() += 1;
            if f.est_muette() {
                agr.muettes.push(format!("{}:{}", court(chemin), f.nom));
            }
            if detail {
                let zones: Vec<String> = f
                    .couleur
                    .zones_presentes()
                    .into_iter()
                    .map(|(z, p)| format!("{} {}", z.nom(), pct(p)))
                    .collect();
                println!(
                    "  {:<44} {:<16} {}×{}  {:<6} {:<12} encre {:<8} [{}]",
                    court(chemin),
                    f.nom,
                    f.couleur.largeur,
                    f.couleur.hauteur,
                    f.role.nom(),
                    f.convention.nom(),
                    pct(f.couleur.part_encre),
                    zones.join(", ")
                );
                if let (Some(nm), Some(m), Some(r)) =
                    (&f.nom_masque, &f.masque, f.role_masque)
                {
                    let zones: Vec<String> = m
                        .zones_presentes()
                        .into_iter()
                        .map(|(z, p)| format!("{} {}", z.nom(), pct(p)))
                        .collect();
                    println!(
                        "  {:<44} {:<16} {:<6} {:<6} vert {} [{}]",
                        "",
                        nm,
                        "msk",
                        r.nom(),
                        fmt_emprise(m.emprise(Zone::Vert)),
                        zones.join(", ")
                    );
                }
            }
            if out.is_some() {
                releve.push(json!({
                    "chemin": chemin,
                    "famille": famille,
                    "planche": f.nom,
                    "role": f.role.nom(),
                    "convention": f.convention.nom(),
                    "muette": f.est_muette(),
                    "couleur": mesures_json(&f.couleur),
                    "masque": f.nom_masque.as_ref().map(|nm| json!({
                        "nom": nm,
                        "role": f.role_masque.map(Role::nom),
                        "mesures": f.masque.as_ref().map(mesures_json),
                    })),
                }));
            }
            if let Some(dir) = extraire {
                std::fs::create_dir_all(dir)?;
                png_ecrits += extraire_planche(dir, &vfs, chemin, &famille, f, vignette)?;
            }
        }
    }

    if illisibles > 0 || sans_planche > 0 {
        println!("  {illisibles} illisible(s), {sans_planche} sans planche de couleur");
    }
    if let Some(dir) = extraire {
        println!("  {png_ecrits} PNG écrits dans {}", dir.display());
    }
    println!();
    println!("  {:<14} {:>5} {:>5}  {:<28} conventions", "famille", "cont.", "plan.", "rôles");
    for (famille, agr) in &par_famille {
        let liste = |m: &BTreeMap<&'static str, usize>| -> String {
            let mut v: Vec<(&&str, &usize)> = m.iter().collect();
            v.sort_by(|a, b| b.1.cmp(a.1));
            v.iter().map(|(k, n)| format!("{k} {n}")).collect::<Vec<_>>().join(", ")
        };
        println!(
            "  {:<14} {:>5} {:>5}  {:<28} {}",
            famille,
            agr.conteneurs,
            agr.planches,
            liste(&agr.roles),
            liste(&agr.conventions)
        );
    }

    let muettes: usize = par_famille.values().map(|a| a.muettes.len()).sum();
    if muettes > 0 {
        println!();
        println!("  {muettes} planche(s) muette(s) — ni tracé dans la couleur, ni forme dans le masque :");
        for (famille, agr) in &par_famille {
            if agr.muettes.is_empty() {
                continue;
            }
            println!(
                "    {famille:<14} {}/{} — {}",
                agr.muettes.len(),
                agr.planches,
                agr.muettes.iter().take(4).cloned().collect::<Vec<_>>().join(", ")
            );
        }
    }

    // Une convention minoritaire est le signal utile : elle dit qu'une règle codée par famille
    // ne couvre pas toute sa famille.
    let mixtes: Vec<&String> =
        par_famille.iter().filter(|(_, a)| a.conventions.len() > 1).map(|(f, _)| f).collect();
    if !mixtes.is_empty() {
        println!();
        println!("  familles à convention non unique : {}", mixtes.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "));
    }

    if let Some(fichier) = out {
        if let Some(parent) = fichier.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(fichier, serde_json::to_vec_pretty(&releve)?)
            .with_context(|| format!("écriture {}", fichier.display()))?;
        println!();
        println!("  {} planche(s) relevée(s) → {}", releve.len(), fichier.display());
    }
    Ok(())
}

/// Chemin raccourci à ce qui distingue une planche d'une autre : famille et nom de fichier.
fn court(chemin: &str) -> String {
    let mut segments: Vec<&str> = chemin.rsplit('/').take(2).collect();
    segments.reverse();
    segments.join("/")
}

/// Ce que `niers avatar` sait faire.
#[derive(Debug, Clone, clap::Subcommand)]
pub enum AvatarCmd {
    /// Vue d'ensemble : les 16 listes, les catégories et leur taux de résolution.
    Catalog,
    /// Les parts d'une catégorie (toutes si `--category` est absent), avec modèles et icône.
    Parts {
        /// `faceSettingType` visé.
        #[arg(long)]
        category: Option<i64>,
        /// Nombre maximum de lignes affichées.
        #[arg(long, default_value_t = 40)]
        limit: usize,
    },
    /// Les visages prédéfinis ; avec un argument, la recette décodée d'un preset.
    Preset {
        /// Nom (`preset_01_normal`) ou hash (`0x06DE46FB`) du preset.
        id: Option<String>,
    },
    /// Écrit le catalogue résolu complet en JSON.
    Export {
        /// Fichier de sortie.
        #[arg(short, long, default_value = "var/avatar-resolved.json")]
        out: std::path::PathBuf,
    },
    /// Dérive les régions de mesure d'un écran depuis son layout, pour `niers img diff`.
    ///
    /// Un rectangle tracé sur une capture est une valeur calée sur l'image de référence : il fait
    /// remonter le score sans rien prouver, et il ne se régénère pas. Ici les régions viennent des
    /// **objets du layout** — donc des fichiers du jeu. Quand un objet n'a pas de géométrie
    /// exploitable, la commande le **déclare non dérivable** au lieu d'inventer une boîte.
    Roi {
        /// Écran (nom du layout, sans `.json`).
        ecran: String,
        /// Répertoire des layouts exportés.
        #[arg(long, default_value = "var/avatar-ui/layouts")]
        layouts: std::path::PathBuf,
        /// Fichier de sortie ; sans lui, la commande n'imprime que ce qu'elle trouve.
        #[arg(short, long)]
        out: Option<std::path::PathBuf>,
    },
    /// Mesure les **planches de texture** de l'éditeur : zones, rôle, convention de composition.
    ///
    /// Les conventions de composition du visage ont été établies planche par planche, à la main,
    /// sur une ou deux textures chacune — puis codées par famille (`if rel.starts_with("01_eye")`).
    /// Cette commande les mesure sur le corpus entier, sans jamais regarder un nom de famille :
    /// une convention qui vaut vraiment pour `01_eye` doit se lire dans les octets de ses 80
    /// planches. Cf. `nie_formats::planche`.
    Planches {
        /// Préfixe VFS balayé.
        #[arg(long, default_value = "chr/_face/20_EDIT/_facetex/")]
        prefix: String,
        /// Ne retient que les chemins contenant ce fragment (une famille, un nom de planche).
        #[arg(long)]
        filtre: Option<String>,
        /// Détaille planche par planche au lieu du seul agrégat par famille.
        #[arg(long)]
        detail: bool,
        /// Écrit le relevé complet en JSON.
        #[arg(short, long)]
        out: Option<std::path::PathBuf>,
        /// Extrait en PNG, dans ce répertoire, la planche, son masque et le tracé qu'en tire la
        /// convention mesurée.
        #[arg(long)]
        extraire: Option<std::path::PathBuf>,
        /// Côté maximal des PNG extraits ; 0 garde la taille d'origine (2048×1024 pour `_facetex`).
        #[arg(long, default_value_t = 0)]
        vignette: u32,
        /// Nombre maximum de conteneurs analysés.
        #[arg(long, default_value_t = usize::MAX)]
        limit: usize,
    },
    /// Mesure le dépliage UV d'un modèle de `20_EDIT`, sous-maille par sous-maille.
    ///
    /// Répond à la question que la mesure des planches laisse ouverte : quelle maille lit quelle
    /// planche. Une planche pleine cadre posée sur une maille qui n'occupe qu'un coin du carré ne
    /// peut pas rendre ce qu'elle dessine.
    Depliage {
        /// Nom ou fragment de chemin du modèle (`face51_nose01`, `_facebase/face51`).
        modele: String,
        /// Nombre maximum de modèles affichés.
        #[arg(long, default_value_t = 8)]
        limit: usize,
    },
    /// Localise les icônes de vignette dans les atlas d'interface, et les extrait en PNG.
    Icons {
        /// Répertoire de sortie ; sans lui, la commande ne fait que localiser.
        #[arg(short, long)]
        out: Option<std::path::PathBuf>,
        /// Préfixe VFS des atlas balayés.
        #[arg(long, default_value = "menu/200_icon/21_icon_avatar/")]
        atlas_prefix: String,
        /// Nombre maximum d'icônes extraites.
        #[arg(long, default_value_t = usize::MAX)]
        limit: usize,
    },
}

/// Les cinq fichiers de l'éditeur, déjà décodés en JSON forme iecode.
struct Sources {
    /// `chara_edit_<ver>.cfg.bin` — les 16 listes.
    catalogue: CharaEditConfig,
    /// `chara_edit_parts_type_config_<ver>.cfg.bin` — modèles de base par morphologie.
    types: nie_data::chara_edit::CharaEditPartsTypeConfig,
    /// `20_EDIT/center.cfg.bin` — atlas de visage.
    center: Json,
    /// `20_EDIT/texPartsDefaultPose.cfg.bin` — poses par défaut.
    pose: Json,
    /// `20_EDIT/editCharaMdlParts.cfg.bin` — règles de modèle.
    rules: Json,
    /// `stem` → chemins du VFS, pour tout ce qui vit sous `20_EDIT/`.
    assets: BTreeMap<String, Vec<String>>,
    /// `menu_text` de la locale demandée : hash → libellé affiché par le jeu.
    textes: BTreeMap<u32, String>,
    /// Racine du jeu, gardée pour les passes qui rouvrent le VFS (extraction d'icônes).
    game_dir: std::path::PathBuf,
    /// Rubriques de l'éditeur dans l'ordre du jeu, `(hash, libellé)` — cf. [`rubriques`].
    rubriques: Vec<(u32, String)>,
    /// Shaders de l'éditeur, `(nom de fichier, taille)` — cf. [`shaders_editeur`].
    shaders: Vec<(String, u64)>,
    /// Écrans `chara_edit*` du jeu, tels que le VFS les nomme.
    ecrans: Vec<String>,
    /// Libellés de chaque panneau de l'éditeur — cf. [`panneaux`].
    panneaux: Vec<Panneau>,
}

/// Les **shaders de l'éditeur** : la famille `chr_edit_toon` de `dx11/shader/`.
///
/// Le jeu range ses shaders par nom, et ceux de l'éditeur de personnage forment une famille
/// nette — `chr_edit_toon` et ses variantes `_hair`, `_metal`, `_metal_adv`, `_cutout`, avec les
/// suffixes `_eff_status(_tex)`. Chaque programme vient en triplet : `.fxbin` (descripteur),
/// `.vfxo` (vertex), `.pfxo` (pixel).
///
/// L'identification se fait par **nom**, pas par contenu : le bytecode est du DXBC compilé, que
/// le dépôt ne désassemble pas. Rien ici ne prétend dire ce que ces shaders calculent.
fn shaders_editeur(vfs: &Vfs) -> Vec<(String, u64)> {
    let mut out: Vec<(String, u64)> = vfs
        .iter()
        .filter_map(|(chemin, entree)| {
            let base = chemin.rsplit('/').next()?;
            if !chemin.contains("/shader/") || !base.starts_with("chr_edit_toon") {
                return None;
            }
            Some((base.to_string(), u64::from(entree.file_size)))
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Cherche l'unique fichier dont le nom de base commence par `prefix` et finit par `.cfg.bin`.
fn find_one(vfs: &Vfs, contains: &str, prefix: &str) -> Result<String> {
    let mut hits: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p.to_string())
        .filter(|p| {
            p.contains(contains)
                && p.rsplit('/')
                    .next()
                    .is_some_and(|b| b.starts_with(prefix) && b.ends_with(".cfg.bin"))
        })
        .collect();
    hits.sort();
    hits.into_iter().next().with_context(|| format!("{prefix}*.cfg.bin introuvable dans le VFS"))
}

/// Lit un `cfg.bin` du VFS et le rend en JSON forme iecode (RDBN à listes ou T2B, indifféremment).
fn read_json(vfs: &Vfs, path: &str) -> Result<Json> {
    let raw = vfs.read(path).with_context(|| format!("lecture {path}"))?;
    cfgbin::to_iecode_json(&raw).with_context(|| format!("décodage cfg.bin {path}"))
}

impl Sources {
    /// Ouvre le VFS et charge les cinq fichiers plus l'index des assets de `20_EDIT/`.
    fn load(game_dir: &Path) -> Result<Self> {
        let mut vfs = Vfs::new();
        vfs.init(game_dir.join("data")).context("init VFS depuis cpk_list.cfg.bin")?;

        let p_cat = find_one(&vfs, "/gamedata/character/", "chara_edit_")?;
        // `chara_edit_parts_type_config_*` commence aussi par `chara_edit_` : le tri alphabétique
        // rend le catalogue d'abord (`chara_edit_1.` < `chara_edit_p`), mais on cible le second
        // par son propre préfixe pour ne pas dépendre de cet ordre.
        let p_types = find_one(&vfs, "/gamedata/character/", "chara_edit_parts_type_config")?;
        eprintln!("  catalogue : {p_cat}");
        eprintln!("  types     : {p_types}");

        let catalogue = parse_chara_edit(&read_json(&vfs, &p_cat)?);
        let types = parse_chara_edit_parts_type_config(&read_json(&vfs, &p_types)?);

        let in_edit = |base: &str| -> Result<Json> {
            let path = vfs
                .iter()
                .map(|(p, _)| p.to_string())
                .find(|p| p.contains(EDIT_ROOT) && p.ends_with(base))
                .with_context(|| format!("{base} introuvable sous {EDIT_ROOT}"))?;
            read_json(&vfs, &path)
        };
        let center = in_edit("center.cfg.bin")?;
        let pose = in_edit("texPartsDefaultPose.cfg.bin")?;
        let rules = in_edit("editCharaMdlParts.cfg.bin")?;

        let mut assets: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (path, _) in vfs.iter() {
            if !path.contains(EDIT_ROOT) {
                continue;
            }
            let Some(base) = path.rsplit('/').next() else { continue };
            let stem = base.split_once('.').map_or(base, |(s, _)| s);
            assets.entry(stem.to_string()).or_default().push(path.to_string());
        }
        for v in assets.values_mut() {
            v.sort();
        }

        // `menu_text` porte les libellés que le jeu affiche pour les personnalités et les
        // avatars-fichiers ; le catalogue ne les référence que par CRC-32.
        let mut textes = BTreeMap::new();
        if let Some(path) = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .find(|p| p.contains("/text/fr/") && p.ends_with("menu_text.cfg.bin"))
            && let Ok(json) = read_json(&vfs, &path) {
                for (hash, texte) in nie_data::text::parse_text_file(&json) {
                    textes.insert(hash.get(), texte);
                }
            }

        let mut ecrans: Vec<String> = vfs
            .iter()
            .filter_map(|(p, _)| {
                let base = p.rsplit('/').next()?;
                let nom = base.strip_suffix("_setting.cfg.bin")?;
                nom.starts_with("chara_edit").then(|| nom.to_string())
            })
            .collect();
        ecrans.sort();
        ecrans.dedup();

        let rubriques = rubriques(&vfs, &textes);
        let shaders = shaders_editeur(&vfs);
        let panneaux = panneaux(&vfs, &textes);

        Ok(Self {
            catalogue,
            types,
            center,
            pose,
            rules,
            assets,
            textes,
            game_dir: game_dir.to_path_buf(),
            rubriques,
            shaders,
            ecrans,
            panneaux,
        })
    }
}

/// Une icône de vignette localisée dans un atlas d'interface.
struct IconLoc {
    /// Chemin VFS de l'atlas `g4tx`.
    atlas: String,
    /// Nom de la texture principale à décoder.
    texture: String,
    /// Rectangle `(x, y, w, h)` de la région, si l'icône est une région d'atlas.
    rect: Option<(i16, i16, i16, i16)>,
}

/// Indexe les noms de textures et de régions des `g4tx` sous `prefix` : nom → où le décoder.
///
/// Les vignettes de l'éditeur sont pour l'essentiel des **régions** d'un grand atlas
/// (`avatar01_00.g4tx` fait 6 Mo) : le nom cherché n'est pas celui d'une texture entière.
fn index_atlases(vfs: &Vfs, prefix: &str, voulus: &BTreeMap<u32, String>) -> BTreeMap<String, IconLoc> {
    let mut out: BTreeMap<String, IconLoc> = BTreeMap::new();
    let noms: std::collections::BTreeSet<&str> = voulus.values().map(String::as_str).collect();
    let paths: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p.to_string())
        .filter(|p| p.contains(prefix) && p.ends_with(".g4tx"))
        .collect();
    for path in paths {
        let Ok(raw) = vfs.read(&path) else { continue };
        let Ok(tx) = nie_formats::g4tx::parse(&raw) else { continue };
        for tex in &tx.textures {
            if noms.contains(tex.name.as_str()) {
                out.entry(tex.name.clone()).or_insert(IconLoc {
                    atlas: path.clone(),
                    texture: tex.name.clone(),
                    rect: None,
                });
            }
            for sub in &tex.sub_textures {
                if noms.contains(sub.name.as_str()) {
                    out.entry(sub.name.clone()).or_insert(IconLoc {
                        atlas: path.clone(),
                        texture: tex.name.clone(),
                        rect: Some((sub.x, sub.y, sub.width, sub.height)),
                    });
                }
            }
        }
    }
    out
}

/// Découpe un rectangle dans un tampon RGBA, en bornant aux dimensions réelles.
fn crop_rgba(
    rgba: &[u8],
    w: u32,
    h: u32,
    rect: (i16, i16, i16, i16),
) -> Option<(u32, u32, Vec<u8>)> {
    let (rx, ry, rw, rh) = rect;
    let (x0, y0) = (u32::try_from(rx.max(0)).ok()?, u32::try_from(ry.max(0)).ok()?);
    let (cw, ch) = (u32::try_from(rw.max(0)).ok()?, u32::try_from(rh.max(0)).ok()?);
    if cw == 0 || ch == 0 || x0 >= w || y0 >= h {
        return None;
    }
    let cw = cw.min(w - x0);
    let ch = ch.min(h - y0);
    let mut out = Vec::with_capacity((cw * ch * 4) as usize);
    for y in 0..ch {
        let start = (((y0 + y) * w + x0) * 4) as usize;
        out.extend_from_slice(&rgba[start..start + (cw * 4) as usize]);
    }
    Some((cw, ch, out))
}

/// Dictionnaire `hash → nom` lu dans `hash_name` de la base de connaissance.
///
/// Sans base, le dictionnaire est vide : les icônes restent des hachages, tout le reste marche.
fn icon_dict(db_path: &Path) -> BTreeMap<u32, String> {
    let mut out = BTreeMap::new();
    let Ok(db) = nie_index::Db::open(db_path) else {
        eprintln!("  (base {} illisible : icônes non résolues)", db_path.display());
        return out;
    };
    let Ok(mut stmt) = db.conn().prepare("SELECT hash, name FROM hash_name WHERE kind='texture'")
    else {
        return out;
    };
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).ok();
    if let Some(rows) = rows {
        for (hash, name) in rows.flatten() {
            out.insert(hash as u32, name);
        }
    }
    out
}

/// Plus long préfixe commun de deux chaînes, en octets (les noms sont ASCII).
fn common_prefix(a: &str, b: &str) -> String {
    let n = a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count();
    a[..n].to_string()
}

/// Libellé d'une catégorie **dérivé des données** : préfixe commun de ses noms de ressources.
fn category_label(cfg: &CharaEditConfig, face_setting_type: i64) -> String {
    let mut label: Option<String> = None;
    for p in cfg.parts_of(face_setting_type) {
        if p.resource_name_str1.is_empty() || p.resource_name_str1.starts_with("0x") {
            continue;
        }
        label = Some(match label {
            None => p.resource_name_str1.clone(),
            Some(l) => common_prefix(&l, &p.resource_name_str1),
        });
    }
    match label {
        Some(l) if !l.is_empty() => l,
        _ => String::from("?"),
    }
}

/// Les chemins VFS d'une ressource nommée (modèle, maillage, texture).
fn resource_paths<'a>(src: &'a Sources, name: &str) -> &'a [String] {
    src.assets.get(name).map_or(&[][..], Vec::as_slice)
}

/// Récolte les nœuds T2B portant un hash en première variable → leurs variables suivantes.
///
/// Sert aux trois tables de `20_EDIT` : chacune indexe une ressource par son CRC-32.
fn table_by_hash(root: &Json, node_name: &str) -> BTreeMap<u32, Vec<f64>> {
    let mut out = BTreeMap::new();
    fn walk(v: &Json, node_name: &str, out: &mut BTreeMap<u32, Vec<f64>>) {
        if let Some(arr) = v.as_array() {
            for x in arr {
                walk(x, node_name, out);
            }
            return;
        }
        let Some(obj) = v.as_object() else { return };
        if let (Some(name), Some(vars)) =
            (obj.get("name").and_then(Json::as_str), obj.get("variables").and_then(Json::as_array))
        {
            // Les noms de nœuds T2B sont suffixés d'un index à la conversion iecode
            // (`TEX_PARTS_CENTER_INFO_3`) : on compare donc par préfixe.
            if name.starts_with(node_name) {
                let nums: Vec<f64> = vars
                    .iter()
                    .filter_map(|var| {
                        let val = var.get("value").or_else(|| {
                            var.as_object()
                                .and_then(|o| o.values().next())
                                .filter(|_| var.get("type").is_none())
                        })?;
                        val.as_f64().or_else(|| val.as_str()?.parse().ok())
                    })
                    .collect();
                if let Some((first, rest)) = nums.split_first() {
                    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                    out.insert(*first as i64 as u32, rest.to_vec());
                }
            }
        }
        for key in ["children", "entries"] {
            if let Some(ch) = obj.get(key) {
                walk(ch, node_name, out);
            }
        }
    }
    walk(root, node_name, &mut out);
    out
}

/// Les centres de `TEX_PARTS_CENTER_INFO`, résolus en **noms de planches de texture**.
///
/// La table est indexée par `crc32`, et ces hachages ne désignent PAS des `resourceName` de parts,
/// contrairement à ce que le reste du catalogue suppose : ce sont les noms des sous-textures des
/// conteneurs de `_facetex/` — mesuré le 2026-09-01 en hachant les noms que les `.g4tx` déclarent
/// eux-mêmes. Les cinq entrées se résolvent alors intégralement :
///
/// | planche | u | v | w | h |
/// |---|---|---|---|---|
/// | `eyebrow_R_01` | 0,3125 | 0,2275 | 0,1309 | 0,0654 |
/// | `eyebrow_L_01` | 0,6875 | 0,2275 | 0,1309 | 0,0654 |
/// | `eye_R_01` | 0,3076 | 0,3896 | 0,0986 | 0,0850 |
/// | `eye_L_01` | 0,6924 | 0,3896 | 0,0986 | 0,0850 |
/// | `mouth_00` | 0,4980 | 0,5996 | 0,1172 | 0,0137 |
///
/// C'est l'anatomie d'un visage : sourcils en haut, yeux dessous, bouche en bas, les paires
/// gauche/droite en miroir exact autour de `u = 0,5`. Et c'est **la même emprise** que celle
/// relevée à la grille témoin dans `nie_formats::image_out` — `eye_R_01` donne
/// `u ∈ [0,258 ; 0,357]`, la grille avait lu `[0,262 ; 0,366]`. Le fichier disait donc déjà ce
/// qu'une capture a servi à retrouver.
///
/// Cinq centres pour six familles : la table est une **référence**, pas une entrée par planche.
/// Rien ici n'extrapole aux autres variantes.
fn centres_de_planches(game_dir: &Path, center: &Json) -> BTreeMap<String, Vec<f64>> {
    let table = table_by_hash(center, "TEX_PARTS_CENTER_INFO");
    let mut vfs = Vfs::new();
    if vfs.init(game_dir.join("data")).is_err() {
        return BTreeMap::new();
    }
    let conteneurs: Vec<String> = vfs
        .iter()
        .filter(|(p, _)| p.contains("20_EDIT/_facetex/") && p.ends_with(".g4tx"))
        .map(|(p, _)| p.to_string())
        .collect();
    let mut out = BTreeMap::new();
    for chemin in conteneurs {
        let Ok(brut) = vfs.read(&chemin) else { continue };
        let Ok(conteneur) = nie_formats::g4tx::parse(&brut) else { continue };
        for tex in &conteneur.textures {
            if let Some(rect) = table.get(&cfgbin::crc32(tex.name.as_bytes())) {
                out.insert(tex.name.clone(), rect.clone());
            }
        }
    }
    out
}

/// Vue résolue d'une part : ce que le catalogue dit, plus ce que le VFS et la base confirment.
fn part_json(
    src: &Sources,
    icons: &BTreeMap<u32, String>,
    trans: &BTreeMap<u32, Vec<f64>>,
    scales: &BTreeMap<u32, Vec<f64>>,
    p: &nie_data::chara_edit::CharaEditPartsData,
) -> Json {
    let name1 = &p.resource_name_str1;
    let hash1 = p.resource_name1.get();
    let hash2 = p.resource_name2.get();
    let tex = p.texture_name.get();
    json!({
        "id": p.id.to_hex_x8(),
        "itemNo": p.item_no,
        "viewNo": p.view_no,
        "gender": p.gender,
        "resource": name1,
        "resourceHash": p.resource_name1.to_hex_x8(),
        "resource2": (!p.resource_name_str2.starts_with("0x")).then(|| p.resource_name_str2.clone()),
        "modeles": resource_paths(src, name1),
        "modeles2": if !p.resource_name_str2.starts_with("0x") { resource_paths(src, &p.resource_name_str2) } else { &[] },
        "icone": icons.get(&tex),
        "iconeHash": p.texture_name.to_hex_x8(),
        // Pas de centre d'atlas ici : `TEX_PARTS_CENTER_INFO` est indexé par nom de PLANCHE, pas
        // par `resourceName` de part. Le champ `atlasCentre` que portait cette vue cherchait
        // `hash1` dans cette table et sortait nul sur les 502 parts, sans que rien ne le signale.
        // Les cinq centres résolus vivent désormais à part — cf. [`centres_de_planches`].
        // `TEX_PARTS_DEFAULT_TRANS_INFO` = (hash, mode entier, puis les composantes) : le mode
        // est séparé ici, sinon il se lit comme une translation de 3,0 unité.
        "poseTransMode": trans.get(&hash1).and_then(|v| v.first()).map(|m| *m as i64),
        "poseTrans": trans.get(&hash1).map(|v| v.get(1..).unwrap_or_default()),
        "poseScale": scales.get(&hash1),
        "resource2Connu": hash2 != 0 && src.assets.contains_key(&p.resource_name_str2),
    })
}

/// Point d'entrée de `niers avatar`.
pub fn run(cmd: &AvatarCmd, game_dir: &Path, db_path: &Path) -> Result<()> {
    // L'analyse des planches ne lit que des textures : la servir avant le catalogue évite de
    // décoder cinq `cfg.bin` et le bytecode des écrans pour rien, et la rend utilisable même là
    // où le catalogue ne se résout pas.
    if let AvatarCmd::Depliage { modele, limit } = cmd {
        return depliage(game_dir, modele, *limit);
    }
    if let AvatarCmd::Planches { prefix, filtre, detail, out, extraire, vignette, limit } = cmd {
        return planches(
            game_dir,
            &OptionsPlanches {
                prefix,
                filtre: filtre.as_deref(),
                detail: *detail,
                out: out.as_deref(),
                extraire: extraire.as_deref(),
                vignette: *vignette,
                limit: *limit,
            },
        );
    }
    let src = Sources::load(game_dir)?;
    let icons = icon_dict(db_path);
    let centres = centres_de_planches(game_dir, &src.center);
    let trans = table_by_hash(&src.pose, "TEX_PARTS_DEFAULT_TRANS_INFO");
    let scales = table_by_hash(&src.pose, "TEX_PARTS_DEFAULT_SCALE_INFO");
    let cfg = &src.catalogue;

    match cmd {
        AvatarCmd::Catalog => {
            println!("chara_edit — catalogue de l'éditeur d'avatar");
            println!(
                "  {} parts, {} catégories, {} curseurs, {} couleurs, {} recettes ({} lignes)",
                cfg.parts.len(),
                cfg.parts_info.len(),
                cfg.params.len(),
                cfg.colors.len(),
                cfg.preset_info.len(),
                cfg.preset_data.len()
            );
            println!(
                "  {} voix, {} personnalités, {} tenues, {} avatars-fichiers",
                cfg.voices.len(),
                cfg.personalities.len(),
                cfg.fashions.len(),
                cfg.preset_files.len()
            );
            println!(
                "  code de partage : {} bits sur un alphabet de {} caractères ({} emplacements)",
                cfg.code_bit_width(),
                cfg.codes.len(),
                cfg.recipes.len()
            );
            println!(
                "  modèles de base : {} visages × morphologie, {} accessoires",
                src.types.face_data.len(),
                src.types.body_data.len()
            );
            println!(
                "  tables de 20_EDIT : {} centres de planche, {} translations, {} échelles",
                centres.len(),
                trans.len(),
                scales.len()
            );
            // Les centres sont peu nombreux et disent où chaque part se pose sur le carré du
            // visage : les afficher vaut mieux que les compter.
            for (nom, rect) in &centres {
                if let [u, v, w, h] = rect[..] {
                    println!("    {nom:<14} u {u:.4}  v {v:.4}  w {w:.4}  h {h:.4}");
                }
            }
            println!("\n  cat  parts  modèles  icônes  préfixe des ressources");
            for info in &cfg.parts_info {
                let parts = cfg.parts_of(info.face_setting_type);
                let with_model = parts
                    .iter()
                    .filter(|p| !resource_paths(&src, &p.resource_name_str1).is_empty())
                    .count();
                let with_icon = parts
                    .iter()
                    .filter(|p| icons.contains_key(&(p.texture_name.get())))
                    .count();
                println!(
                    "  {:>3}  {:>5}  {:>7}  {:>6}  {}",
                    info.face_setting_type,
                    parts.len(),
                    with_model,
                    with_icon,
                    category_label(cfg, info.face_setting_type)
                );
            }
            let total_model = cfg
                .parts
                .iter()
                .filter(|p| !resource_paths(&src, &p.resource_name_str1).is_empty())
                .count();
            let total_icon =
                cfg.parts.iter().filter(|p| icons.contains_key(&(p.texture_name.get()))).count();
            println!(
                "\n  résolu : {total_model}/{} modèles dans le VFS, {total_icon}/{} icônes dans hash_name",
                cfg.parts.len(),
                cfg.parts.len()
            );
            if src.rubriques.is_empty() {
                println!("  rubriques : aucune suite de libellés trouvée dans le script de liste");
            } else {
                println!("\n  rubriques de l'éditeur, dans l'ordre du jeu ({}) :", src.rubriques.len());
                for (i, (h, libelle)) in src.rubriques.iter().enumerate() {
                    println!("   {:>2}. {libelle}  (0x{h:08X})", i + 1);
                }
            }
            if !src.shaders.is_empty() {
                let octets: u64 = src.shaders.iter().map(|(_, t)| *t).sum();
                println!(
                    "  shaders : {} fichiers `chr_edit_toon*` ({:.1} Kio) — identifies par nom, DXBC non desassemble",
                    src.shaders.len(),
                    octets as f64 / 1024.0
                );
            }
            let libelles =
                cfg.personalities.iter().filter(|p| src.textes.contains_key(&p.view_text_id.get())).count();
            println!(
                "  libellés : {libelles}/{} personnalités nommées par menu_text (fr)",
                cfg.personalities.len()
            );
        }

        AvatarCmd::Parts { category, limit } => {
            let sel: Vec<&nie_data::chara_edit::CharaEditPartsData> = match category {
                Some(c) => cfg.parts_of(*c).iter().collect(),
                None => cfg.parts.iter().collect(),
            };
            println!("{} part(s)", sel.len());
            for p in sel.iter().take(*limit) {
                let paths = resource_paths(&src, &p.resource_name_str1);
                println!(
                    "  {:>3} {:<24} {:<26} {}",
                    p.item_no,
                    if p.resource_name_str1.is_empty() {
                        p.resource_name1.to_hex_x8()
                    } else {
                        p.resource_name_str1.clone()
                    },
                    icons
                        .get(&(p.texture_name.get()))
                        .cloned()
                        .unwrap_or_else(|| p.texture_name.to_hex_x8()),
                    paths.first().map_or("(modèle absent)", String::as_str)
                );
            }
            if sel.len() > *limit {
                println!("  … {} de plus (--limit)", sel.len() - *limit);
            }
        }

        AvatarCmd::Preset { id } => match id {
            None => {
                println!("{} visage(s) prédéfini(s)", cfg.preset_info.len());
                for pi in &cfg.preset_info {
                    let nom = cfg
                        .parts
                        .iter()
                        .find(|p| p.resource_name1 == pi.preset_id)
                        .map(|p| p.resource_name_str1.clone())
                        .unwrap_or_default();
                    let morph: Vec<&str> = nie_data::chara_edit::BODY_TYPES
                        .iter()
                        .zip(pi.apply)
                        .filter_map(|(bt, ok)| ok.then_some(*bt))
                        .collect();
                    println!(
                        "  {} {:<20} {:>3} lignes  morphologies: {}",
                        pi.preset_id.to_hex_x8(),
                        nom,
                        pi.data_count,
                        if morph.len() == 8 { String::from("toutes") } else { morph.join(",") }
                    );
                }
            }
            Some(arg) => {
                let hash = if let Some(hex) = arg.strip_prefix("0x") {
                    u32::from_str_radix(hex, 16).context("hash de preset invalide")?
                } else {
                    cfgbin::crc32(arg.as_bytes())
                };
                let key = nie_data::hash::HashId::from_i64(i64::from(hash));
                let recipe = cfg.recipe_of(key);
                anyhow::ensure!(!recipe.is_empty(), "aucune recette pour {arg} (0x{hash:08X})");
                println!("recette {arg} (0x{hash:08X}) — {} lignes", recipe.len());
                println!("  empl.  cat  val  couleur  part");
                for line in recipe {
                    let r = cfg.recipes.iter().find(|r| r.recipe_type == line.recipe_type);
                    let part = cfg.part(line.parts_id);
                    println!(
                        "  {:>5}  {:>3}  {:>3}  {:>7}  {}",
                        line.recipe_type,
                        r.map_or(-1, |r| r.category),
                        line.recipe_no,
                        line.color_value,
                        part.map_or_else(
                            || if line.parts_id.is_zero() {
                                String::from("—")
                            } else {
                                line.parts_id.to_hex_x8()
                            },
                            |p| if p.resource_name_str1.is_empty() {
                                p.resource_name1.to_hex_x8()
                            } else {
                                p.resource_name_str1.clone()
                            }
                        )
                    );
                }
            }
        },

        AvatarCmd::Export { out } => {
            let categories: Vec<Json> = cfg
                .parts_info
                .iter()
                .map(|info| {
                    json!({
                        "faceSettingType": info.face_setting_type,
                        "prefixe": category_label(cfg, info.face_setting_type),
                        "parts": cfg.parts_of(info.face_setting_type).iter()
                            .map(|p| part_json(&src, &icons, &trans, &scales, p))
                            .collect::<Vec<_>>(),
                        "couleurs": cfg.colors_of(info.face_setting_type).iter()
                            .map(|h| h.to_hex_x8()).collect::<Vec<_>>(),
                        // Grille de la palette, recoupée par le nom des écrans du jeu.
                        "ecran": ecran_de_categorie(&category_label(cfg, info.face_setting_type), &src.ecrans),
                        "grillePalette": geometrie_palette(cfg.colors_of(info.face_setting_type).len())
                            .map(|(c, l)| json!({ "colonnes": c, "lignes": l })),
                    })
                })
                .collect();

            let presets: Vec<Json> = cfg
                .preset_info
                .iter()
                .map(|pi| {
                    json!({
                        "presetID": pi.preset_id.to_hex_x8(),
                        "nom": cfg.parts.iter().find(|p| p.resource_name1 == pi.preset_id)
                            .map(|p| p.resource_name_str1.clone()),
                        "morphologies": nie_data::chara_edit::BODY_TYPES.iter().zip(pi.apply)
                            .filter_map(|(bt, ok)| ok.then_some(*bt)).collect::<Vec<_>>(),
                        "recette": cfg.recipe_of(pi.preset_id).iter().map(|l| json!({
                            "emplacement": l.recipe_type,
                            "valeur": l.recipe_no,
                            "couleur": l.color_value,
                            "part": cfg.part(l.parts_id).map(|p| p.resource_name_str1.clone()),
                        })).collect::<Vec<_>>(),
                    })
                })
                .collect();

            let doc = json!({
                "source": "chara_edit + chara_edit_parts_type_config + 20_EDIT/{center,texPartsDefaultPose,editCharaMdlParts}",
                // Où chaque planche se pose sur le carré du visage, en fraction de texture.
                // Indexé par nom de PLANCHE — c'est ce que la table hache, et non un
                // `resourceName` de part. Cf. `centres_de_planches`.
                "centresDePlanches": centres.iter().map(|(nom, r)| json!({
                    "planche": nom,
                    "u": r.first(), "v": r.get(1), "largeur": r.get(2), "hauteur": r.get(3),
                })).collect::<Vec<_>>(),
                "codePartage": {
                    "bits": cfg.code_bit_width(),
                    "alphabet": cfg.codes.iter().map(|c| c.code_char.clone()).collect::<Vec<_>>(),
                    "emplacements": cfg.recipes.iter().map(|r| json!({
                        "emplacement": r.recipe_type, "bits": r.bit_num, "valeurs": r.num,
                        "categorie": r.category, "param": r.category_param, "paramSub": r.category_param_sub,
                    })).collect::<Vec<_>>(),
                },
                // Ordre et libellés établis ; l'association à un `faceSettingType` ne l'est pas.
                "shaders": src.shaders.iter().map(|(nom, taille)| json!({
                    "fichier": nom, "octets": taille,
                })).collect::<Vec<_>>(),
                "rubriques": src.rubriques.iter().map(|(h, libelle)| json!({
                    "hash": format!("{h:08X}"), "libelle": libelle,
                })).collect::<Vec<_>>(),
                // Les sept axes du radar de statistiques, dans l'ordre du dessin.
                "statsRadar": STATS_RADAR.iter().map(|h| json!({
                    "hash": format!("{h:08X}"),
                    "libelle": src.textes.get(h).cloned().unwrap_or_default(),
                })).collect::<Vec<_>>(),
                // Les libellés que chaque panneau affiche, lus dans son script : c'est la source
                // des titres de sections et de curseurs, aucun n'est écrit à la main.
                "panneaux": src.panneaux.iter().map(|p| json!({
                    "nom": p.nom,
                    "libelles": p.libelles.iter().map(|(h, l, g)| json!({
                        "hash": format!("{h:08X}"), "libelle": l, "gaiji": g,
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
                "categories": categories,
                "presets": presets,
                "avatarsFichiers": cfg.preset_files.iter().map(|f| json!({
                    "nom": f.id_string, "viewNo": f.view_no,
                    "charaId": f.chara_id.to_hex_x8(),
                    "modeles": resource_paths(&src, &f.id_string),
                    "libelle": src.textes.get(&f.view_text_id.get()),
                })).collect::<Vec<_>>(),
                "voix": cfg.voices.iter().map(|v| json!({
                    "banque": v.chara_se_name, "genre": v.gender,
                    "personnalite": v.personality, "ton": v.voice_type, "itemNo": v.item_no,
                })).collect::<Vec<_>>(),
                "personnalites": cfg.personalities.iter().map(|p| json!({
                    "type": p.personality_type, "presentation": p.performance_type,
                    "texte": p.view_text_id.to_hex_x8(),
                    "libelle": src.textes.get(&p.view_text_id.get()),
                })).collect::<Vec<_>>(),
                "tenues": cfg.fashions.iter().map(|f| json!({
                    "id": f.id, "hash": f.fashion_name_crc.to_hex_x8(),
                    "morphologies": cfg.body_types_of_fashion(f.fashion_name_crc),
                })).collect::<Vec<_>>(),
                "curseurs": cfg.params_info.iter().map(|gi| json!({
                    "partsType": gi.parts_type,
                    "params": cfg.params_of(gi.parts_type).iter().map(|p| json!({
                        "part": p.parts_id.to_hex_x8(), "axe": p.param_type,
                        "defaut": p.param_default, "min": p.param_min, "max": p.param_max,
                        "morphologies": nie_data::chara_edit::BODY_TYPES.iter().zip(p.apply)
                            .filter_map(|(bt, ok)| ok.then_some(*bt)).collect::<Vec<_>>(),
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
                "modelesDeBase": {
                    "morphologies": nie_data::chara_edit::BODY_TYPES,
                    "visages": src.types.face_data.iter().map(|f| json!({
                        "noseType": f.nose_type, "resources": f.resource,
                    })).collect::<Vec<_>>(),
                    "accessoires": src.types.body_data.iter().map(|b| json!({
                        "presetID": b.preset_id.to_hex_x8(), "resources": b.resource,
                    })).collect::<Vec<_>>(),
                },
                "reglesModele": src.rules,
            });

            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            std::fs::write(out, serde_json::to_vec_pretty(&doc)?)
                .with_context(|| format!("écriture {}", out.display()))?;
            println!(
                "écrit {} — {} catégories, {} parts, {} presets",
                out.display(),
                cfg.parts_info.len(),
                cfg.parts.len(),
                cfg.preset_info.len()
            );
        }

        AvatarCmd::Roi { ecran, layouts, out } => return roi(ecran, layouts, out.as_deref()),

        // Déjà traitées en tête, avant le chargement des sources.
        AvatarCmd::Planches { .. } | AvatarCmd::Depliage { .. } => {}

        AvatarCmd::Icons { out, atlas_prefix, limit } => {
            // Les noms voulus : l'icône de chaque part, résolue depuis `hash_name`.
            let voulus: BTreeMap<u32, String> = cfg
                .parts
                .iter()
                .filter_map(|p| {
                    let h = p.texture_name.get();
                    icons.get(&h).map(|n| (h, n.clone()))
                })
                .collect();
            println!("{} icône(s) nommée(s) à localiser", voulus.len());

            let mut vfs = Vfs::new();
            vfs.init(src.game_dir.join("data")).context("init VFS")?;
            let localisees = index_atlases(&vfs, atlas_prefix, &voulus);
            println!(
                "  {}/{} localisées dans les atlas sous {atlas_prefix}",
                localisees.len(),
                voulus.len()
            );
            let manquantes: Vec<&String> =
                voulus.values().filter(|n| !localisees.contains_key(n.as_str())).collect();
            if !manquantes.is_empty() {
                println!(
                    "  {} non localisée(s), ex. {}",
                    manquantes.len(),
                    manquantes.iter().take(5).map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
                );
            }

            let Some(dir) = out else {
                for (nom, loc) in localisees.iter().take(20) {
                    println!(
                        "  {nom:<26} {} [{}]{}",
                        loc.texture,
                        loc.atlas.rsplit('/').next().unwrap_or(&loc.atlas),
                        loc.rect.map_or(String::new(), |(x, y, w, h)| format!(" {x},{y} {w}×{h}"))
                    );
                }
                return Ok(());
            };
            std::fs::create_dir_all(dir)?;
            // Un atlas de 6 Mo ne se décode qu'une fois, quel que soit le nombre d'icônes.
            let mut cache: BTreeMap<(String, String), Option<Rgba>> = BTreeMap::new();
            let (mut ecrits, mut echecs) = (0usize, 0usize);
            for (nom, loc) in localisees.iter().take(*limit) {
                let key = (loc.atlas.clone(), loc.texture.clone());
                if !cache.contains_key(&key) {
                    let decoded = vfs.read(&loc.atlas).ok().and_then(|raw| {
                        nie_formats::g4tx_decode::decode_named_to_rgba(&raw, &loc.texture)
                    });
                    cache.insert(key.clone(), decoded);
                }
                let Some(Some((w, h, rgba))) = cache.get(&key) else {
                    echecs += 1;
                    continue;
                };
                let png = match loc.rect {
                    Some(rect) => crop_rgba(rgba, *w, *h, rect).and_then(|(cw, ch, buf)| {
                        nie_formats::g4tx_decode::encode_rgba_to_png(&buf, cw as usize, ch as usize)
                    }),
                    None => nie_formats::g4tx_decode::encode_rgba_to_png(
                        rgba,
                        *w as usize,
                        *h as usize,
                    ),
                };
                match png {
                    Some(bytes) => {
                        std::fs::write(dir.join(format!("{nom}.png")), bytes)?;
                        ecrits += 1;
                    }
                    None => echecs += 1,
                }
            }
            println!("  {ecrits} PNG écrits dans {}, {echecs} échec(s)", dir.display());
        }
    }
    Ok(())
}
