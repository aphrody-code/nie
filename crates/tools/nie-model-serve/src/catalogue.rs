//! Catalogues lus dans les `cfg.bin` **réels** du VFS : la recette de tenue (`chara_parts`) et
//! la fiche modèle d'un personnage (`chara_model`). Ce sont les sources d'autorité de
//! l'assemblage : aucun chemin de pièce n'est déduit d'une convention de nommage.
//!
//! ## `chara_parts_*.cfg.bin` — structure recoupée le 2026-09-04
//!
//! ```text
//! CHARA_PARTS_CLOTHES_MODEL_LIST_BEG
//!   CHARA_PARTS_CLOTHES_MODEL          [crc32(code), code]            ex. [0xF0006501, "u011001_10"]
//!   CHARA_PARTS_CLOTHES_MODEL_REF_INFO [début, nombre]                ex. [774, 14]
//!   …
//! CHARA_PARTS_CLOTHES_INFO_LIST_BEG
//!   #774 CHARA_PARTS_CLOTHES_INFO [u.g4md, u.g4tx, profil 0, n.g4md, n.g4tx, crc, sk.g4md, sk.g4tx, m.g4md, m.g4tx, …]
//!   #775 CHARA_PARTS_CLOTHES_INFO [u2.g4md, 0, profil 1, n2.g4md, 0, 0, sk2.g4md, 0, m2.g4md, 0, …]
//!   …    (une ligne par profil corporel ; `Int(0)` = « hérite de la ligne de tête », jamais un chemin)
//! CHARA_PARTS_SHOES_MODEL_LIST_BEG / CHARA_PARTS_SHOES_INFO_LIST_BEG    idem, lignes [g4md, g4tx|0, profil]
//! CHARA_PARTS_GLOVE_MODEL_LIST_BEG / CHARA_PARTS_GLOVE_INFO_LIST_BEG    idem
//! ```
//!
//! Le CRC est le CRC32 IEEE du code logique (`crc32("u011001_10") = 0xF0006501`), le même que
//! `inagle_uniforms.models[].uniformFielderModelIdCrc` et que `CHARA_MODEL_INFO.var[5]`.
//!
//! ## `chara_model_*.cfg.bin`
//!
//! ```text
//! CHARA_MODEL_INFO [id, objbin|0, 0, 0, body_id, uniform_crc, shoes_crc, glove_crc, …, var[10] = face .g4md]
//! CHARA_BODY_INFO  [body_id, objbin du corps, g4md, skeleton_crc, type_idx (= profil), 0, mesh_profile]
//! ```

use std::collections::HashMap;

use nie_formats::cfgbin::{CfgEntry, Value};

/// Chemin relatif sous `chr/`, en minuscules, séparateurs normalisés.
fn relative(path: &str) -> String {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    normalized
        .split_once("/chr/")
        .map_or(normalized.clone(), |(_, rel)| rel.to_string())
        .trim_start_matches('/')
        .to_string()
}

/// Nom de fichier sans extension.
pub fn stem(path: &str) -> &str {
    let base = path.rsplit(['/', '\\']).next().unwrap_or(path);
    base.split_once('.').map_or(base, |(s, _)| s)
}

fn string_at(entry: &CfgEntry, index: usize) -> Option<&str> {
    match entry.variables.get(index) {
        Some(Value::String(value)) if !value.is_empty() => Some(value),
        _ => None,
    }
}

fn int_at(entry: &CfgEntry, index: usize) -> Option<i32> {
    match entry.variables.get(index) {
        Some(Value::Int(value)) => Some(*value),
        _ => None,
    }
}

/// Référence à une pièce : son modèle et, si la ligne la porte, sa texture.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PartRef {
    /// `_uniform/n000101/n000101.g4md` (relatif à `chr/`).
    pub g4md: String,
    /// `_uniform/n000101/n000101_10.g4tx` (relatif à `chr/`), `None` si la ligne dit `Int(0)`.
    pub g4tx: Option<String>,
}

/// Une ligne `CHARA_PARTS_CLOTHES_INFO` : le haut et ses trois pièces liées, pour un profil.
#[derive(Clone, Debug)]
pub struct ClothesRow {
    /// Index de la ligne dans la liste INFO (traçabilité).
    pub index: usize,
    /// Profil corporel (`var[2]`).
    pub profile: i32,
    /// Haut de la tenue.
    pub uniform: PartRef,
    /// Plaque de nom (`n`).
    pub nameplate: Option<PartRef>,
    /// Peau / cou / bras (`sk`).
    pub skin: Option<PartRef>,
    /// Brassard (`m`).
    pub armband: Option<PartRef>,
}

/// Une ligne `CHARA_PARTS_SHOES_INFO` / `CHARA_PARTS_GLOVE_INFO`.
#[derive(Clone, Debug)]
pub struct PartRow {
    /// Index de la ligne dans sa liste INFO.
    pub index: usize,
    /// Profil corporel (`var[2]`).
    pub profile: i32,
    /// La pièce.
    pub part: PartRef,
}

/// Une famille : un code logique, son CRC, et une ligne par profil.
#[derive(Clone, Debug)]
pub struct Family<R> {
    /// Code logique (`u011001_10`).
    pub code: String,
    /// CRC32 IEEE du code.
    pub crc: u32,
    /// Lignes de la famille, dans l'ordre du fichier (la première porte les textures).
    pub rows: Vec<R>,
}

/// Catalogue des pièces de tenue.
#[derive(Default, Debug)]
pub struct CharacterPartsCatalog {
    /// Familles de hauts, par CRC.
    pub clothes: HashMap<u32, Family<ClothesRow>>,
    /// Familles de chaussures, par CRC.
    pub shoes: HashMap<u32, Family<PartRow>>,
    /// Familles de gants, par CRC.
    pub gloves: HashMap<u32, Family<PartRow>>,
    /// Chemin VFS du fichier lu (traçabilité).
    pub source: String,
}

/// Une pièce résolue, prête à être lue dans le VFS.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedPart {
    /// Rôle : `uniform`, `nameplate`, `skin`, `armband`, `shoes`, `gloves`.
    pub role: &'static str,
    /// Modèle, relatif à `chr/`.
    pub g4md: String,
    /// Texture, relative à `chr/` (héritée de la ligne de tête si la ligne du profil dit 0).
    pub g4tx: Option<String>,
    /// Famille d'origine.
    pub family: String,
    /// CRC de la famille.
    pub crc: u32,
    /// Profil demandé.
    pub profile_requested: i32,
    /// Profil de la ligne retenue (peut différer si la famille ne connaît pas le profil demandé).
    pub profile_used: i32,
    /// Index de la ligne INFO retenue.
    pub row_index: usize,
}

impl ResolvedPart {
    /// Nom court de la pièce (`u011001`).
    pub fn name(&self) -> &str {
        stem(&self.g4md)
    }
}

fn part_ref(entry: &CfgEntry, model_index: usize, texture_index: usize) -> Option<PartRef> {
    Some(PartRef {
        g4md: relative(string_at(entry, model_index)?),
        g4tx: string_at(entry, texture_index).map(relative),
    })
}

/// Lignes d'une famille : `MODEL [crc, code?]` suivi de `MODEL_REF_INFO [début, nombre]`.
///
/// Les hauts portent leur code logique (`u011001_10`) ; les chaussures et les gants n'ont que
/// le CRC — leur code est alors déduit de la texture de la ligne de tête (`s011001_10.g4tx`).
fn families(model_list: &[CfgEntry], model_name: &str) -> Vec<(u32, Option<String>, usize, usize)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < model_list.len() {
        let row = &model_list[i];
        if row.name == model_name
            && let Some(crc) = int_at(row, 0)
            && let Some(reference) = model_list.get(i + 1)
            && reference.name == format!("{model_name}_REF_INFO")
            && let (Some(start), Some(count)) = (int_at(reference, 0), int_at(reference, 1))
            && start >= 0
            && count > 0
        {
            let code = string_at(row, 1).map(str::to_string);
            out.push((crc as u32, code, start as usize, count as usize));
            i += 2;
        } else {
            i += 1;
        }
    }
    out
}

impl CharacterPartsCatalog {
    /// Construit le catalogue depuis les entrées racine d'un `chara_parts*.cfg.bin`.
    pub fn from_entries(entries: &[CfgEntry], source: &str) -> Self {
        let list = |name: &str| -> &[CfgEntry] {
            entries
                .iter()
                .find(|e| e.name == name)
                .map_or(&[], |e| e.children.as_slice())
        };
        let clothes_info = list("CHARA_PARTS_CLOTHES_INFO_LIST_BEG");
        let shoes_info = list("CHARA_PARTS_SHOES_INFO_LIST_BEG");
        let gloves_info = list("CHARA_PARTS_GLOVE_INFO_LIST_BEG");

        let mut catalog = Self {
            source: source.to_string(),
            ..Self::default()
        };

        for (crc, code, start, count) in families(
            list("CHARA_PARTS_CLOTHES_MODEL_LIST_BEG"),
            "CHARA_PARTS_CLOTHES_MODEL",
        ) {
            let rows: Vec<ClothesRow> = clothes_info
                .iter()
                .enumerate()
                .skip(start)
                .take(count)
                .filter(|(_, e)| e.name == "CHARA_PARTS_CLOTHES_INFO")
                .filter_map(|(index, e)| {
                    Some(ClothesRow {
                        index,
                        profile: int_at(e, 2).unwrap_or(0),
                        uniform: part_ref(e, 0, 1)?,
                        nameplate: part_ref(e, 3, 4),
                        skin: part_ref(e, 6, 7),
                        armband: part_ref(e, 8, 9),
                    })
                })
                .collect();
            if !rows.is_empty() {
                let code = code
                    .or_else(|| rows[0].uniform.g4tx.as_deref().map(|t| stem(t).to_string()))
                    .unwrap_or_else(|| format!("{crc:#010x}"));
                catalog
                    .clothes
                    .entry(crc)
                    .or_insert(Family { code, crc, rows });
            }
        }

        for (kind, model_list, info, target) in [
            (
                "SHOES",
                list("CHARA_PARTS_SHOES_MODEL_LIST_BEG"),
                shoes_info,
                0usize,
            ),
            (
                "GLOVE",
                list("CHARA_PARTS_GLOVE_MODEL_LIST_BEG"),
                gloves_info,
                1usize,
            ),
        ] {
            let model_name = format!("CHARA_PARTS_{kind}_MODEL");
            let info_name = format!("CHARA_PARTS_{kind}_INFO");
            for (crc, code, start, count) in families(model_list, &model_name) {
                let rows: Vec<PartRow> = info
                    .iter()
                    .enumerate()
                    .skip(start)
                    .take(count)
                    .filter(|(_, e)| e.name == info_name)
                    .filter_map(|(index, e)| {
                        Some(PartRow {
                            index,
                            profile: int_at(e, 2).unwrap_or(0),
                            part: part_ref(e, 0, 1)?,
                        })
                    })
                    .collect();
                if rows.is_empty() {
                    continue;
                }
                let code = code
                    .or_else(|| rows[0].part.g4tx.as_deref().map(|t| stem(t).to_string()))
                    .unwrap_or_else(|| format!("{crc:#010x}"));
                let family = Family { code, crc, rows };
                if target == 0 {
                    catalog.shoes.entry(crc).or_insert(family);
                } else {
                    catalog.gloves.entry(crc).or_insert(family);
                }
            }
        }
        catalog
    }

    /// Résout le haut et ses pièces liées (plaque, peau, brassard) pour un CRC et un profil.
    /// `None` si le CRC est inconnu du catalogue.
    pub fn resolve_clothes(&self, crc: u32, profile: i32) -> Option<Vec<ResolvedPart>> {
        let family = self.clothes.get(&crc)?;
        let head = family.rows.first()?;
        let row = family
            .rows
            .iter()
            .find(|r| r.profile == profile)
            .or_else(|| family.rows.iter().find(|r| r.profile == 0))
            .unwrap_or(head);
        let mut out = Vec::with_capacity(4);
        let make = |role: &'static str, part: &PartRef, inherited: Option<&PartRef>| ResolvedPart {
            role,
            g4md: part.g4md.clone(),
            g4tx: part
                .g4tx
                .clone()
                .or_else(|| inherited.and_then(|p| p.g4tx.clone())),
            family: family.code.clone(),
            crc: family.crc,
            profile_requested: profile,
            profile_used: row.profile,
            row_index: row.index,
        };
        out.push(make("uniform", &row.uniform, Some(&head.uniform)));
        if let Some(p) = &row.nameplate {
            out.push(make("nameplate", p, head.nameplate.as_ref()));
        }
        if let Some(p) = &row.skin {
            out.push(make("skin", p, head.skin.as_ref()));
        }
        if let Some(p) = &row.armband {
            out.push(make("armband", p, head.armband.as_ref()));
        }
        Some(out)
    }

    /// Résout des chaussures (`shoes`) ou des gants (`gloves`) par CRC et profil.
    pub fn resolve_part(&self, role: &'static str, crc: u32, profile: i32) -> Option<ResolvedPart> {
        let table = match role {
            "shoes" => &self.shoes,
            "gloves" => &self.gloves,
            _ => return None,
        };
        let family = table.get(&crc)?;
        let head = family.rows.first()?;
        let row = family
            .rows
            .iter()
            .find(|r| r.profile == profile)
            .or_else(|| family.rows.iter().find(|r| r.profile == 0))
            .unwrap_or(head);
        Some(ResolvedPart {
            role,
            g4md: row.part.g4md.clone(),
            g4tx: row.part.g4tx.clone().or_else(|| head.part.g4tx.clone()),
            family: family.code.clone(),
            crc: family.crc,
            profile_requested: profile,
            profile_used: row.profile,
            row_index: row.index,
        })
    }

    /// Code logique d'une famille de hauts (`u011001_10`) pour un CRC.
    pub fn clothes_code(&self, crc: u32) -> Option<&str> {
        self.clothes.get(&crc).map(|f| f.code.as_str())
    }
}

/// Fiche `CHARA_MODEL_INFO` d'un personnage.
#[derive(Clone, Debug)]
pub struct CharaModelRow {
    /// `var[0]`.
    pub id: i32,
    /// `var[4]` → [`BodyRow::id`].
    pub body_id: i32,
    /// `var[5]` : CRC de la tenue par défaut du modèle (0 si aucune).
    pub uniform_crc: u32,
    /// `var[6]` : CRC des chaussures par défaut (clé de `CHARA_PARTS_SHOES_MODEL`, 0 si aucune).
    pub shoes_crc: u32,
    /// `var[7]` : CRC des gants par défaut (clé de `CHARA_PARTS_GLOVE_MODEL`, 0 si aucun).
    pub glove_crc: u32,
    /// `var[10]` : modèle de visage, relatif à `chr/` (casse d'origine conservée : le VFS est
    /// sensible à la casse, `_face/01_IE1/...`).
    pub face_g4md: Option<String>,
    /// `var[1]` : objbin du modèle complet (séries VICTORY), relatif à `chr/`.
    pub objbin: Option<String>,
}

/// Fiche `CHARA_BODY_INFO`.
#[derive(Clone, Debug)]
pub struct BodyRow {
    /// `var[0]`.
    pub id: i32,
    /// `var[1]` : objbin du corps (`_common/c000101/c000101.objbin`), casse d'origine.
    pub objbin: String,
    /// `var[3]`.
    pub skeleton_crc: i32,
    /// `var[4]` : indice de type corporel = profil des pièces.
    pub type_idx: i32,
    /// `var[6]` : profil de maille.
    pub mesh_profile: i32,
}

impl BodyRow {
    /// Nom court du squelette (`c000101`), déduit de l'objbin du corps.
    pub fn skeleton_stem(&self) -> &str {
        stem(&self.objbin)
    }
}

/// Catalogue `chara_model`.
#[derive(Default, Debug)]
pub struct CharaModelCatalog {
    /// Fiche par code interne (`c01001900`), en minuscules.
    pub by_code: HashMap<String, CharaModelRow>,
    /// Corps par identifiant.
    pub bodies: HashMap<i32, BodyRow>,
    /// Chemin VFS du fichier lu.
    pub source: String,
}

/// Chemin relatif sous `chr/` en conservant la casse d'origine.
fn relative_cased(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();
    match lower.find("/chr/") {
        Some(pos) => normalized[pos + 5..].trim_start_matches('/').to_string(),
        None => normalized.trim_start_matches('/').to_string(),
    }
}

impl CharaModelCatalog {
    /// Construit le catalogue depuis les entrées racine d'un `chara_model*.cfg.bin`.
    pub fn from_entries(entries: &[CfgEntry], source: &str) -> Self {
        let mut catalog = Self {
            source: source.to_string(),
            ..Self::default()
        };
        fn visit(entry: &CfgEntry, catalog: &mut CharaModelCatalog) {
            match entry.name.as_str() {
                "CHARA_MODEL_INFO" => {
                    let face = string_at(entry, 10).map(relative_cased);
                    let objbin = string_at(entry, 1).map(relative_cased);
                    let key = face
                        .as_deref()
                        .or(objbin.as_deref())
                        .map(|p| stem(p).to_ascii_lowercase());
                    if let Some(key) = key {
                        let row = CharaModelRow {
                            id: int_at(entry, 0).unwrap_or(0),
                            body_id: int_at(entry, 4).unwrap_or(0),
                            uniform_crc: int_at(entry, 5).unwrap_or(0) as u32,
                            shoes_crc: int_at(entry, 6).unwrap_or(0) as u32,
                            glove_crc: int_at(entry, 7).unwrap_or(0) as u32,
                            face_g4md: face,
                            objbin,
                        };
                        // Plusieurs fiches partagent un visage (variantes de tenue) : la première
                        // qui nomme une tenue prime, sinon la première tout court.
                        match catalog.by_code.get(&key) {
                            Some(existing) if existing.uniform_crc != 0 || row.uniform_crc == 0 => {
                            }
                            _ => {
                                catalog.by_code.insert(key, row);
                            }
                        }
                    }
                }
                "CHARA_BODY_INFO" => {
                    if let (Some(id), Some(objbin)) = (int_at(entry, 0), string_at(entry, 1)) {
                        catalog.bodies.entry(id).or_insert(BodyRow {
                            id,
                            objbin: relative_cased(objbin),
                            skeleton_crc: int_at(entry, 3).unwrap_or(0),
                            type_idx: int_at(entry, 4).unwrap_or(0),
                            mesh_profile: int_at(entry, 6).unwrap_or(0),
                        });
                    }
                }
                _ => {}
            }
            for child in &entry.children {
                visit(child, catalog);
            }
        }
        for entry in entries {
            visit(entry, &mut catalog);
        }
        catalog
    }

    /// Fiche d'un personnage par code interne (insensible à la casse).
    pub fn row(&self, code: &str) -> Option<&CharaModelRow> {
        self.by_code.get(&code.to_ascii_lowercase())
    }

    /// Corps d'une fiche.
    pub fn body(&self, row: &CharaModelRow) -> Option<&BodyRow> {
        self.bodies.get(&row.body_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nie_formats::cfgbin::Value::{Int, String as CfgString};

    fn row(name: &str, variables: Vec<Value>) -> CfgEntry {
        CfgEntry {
            name: name.to_string(),
            variables,
            children: Vec::new(),
        }
    }

    fn list(name: &str, children: Vec<CfgEntry>) -> CfgEntry {
        CfgEntry {
            name: name.to_string(),
            variables: vec![Int(children.len() as i32)],
            children,
        }
    }

    /// Reproduit la structure réelle de `chara_parts_0.07.22.cfg.bin` autour de la tenue Zeus :
    /// la famille `u011001_10` (CRC 0xF0006501) à l'index 2 de la liste INFO, deux profils,
    /// le second héritant ses textures ; chaussures `s011001_10` et gants `g011001_10`.
    fn catalogue_zeus() -> CharacterPartsCatalog {
        let entries = vec![
            list(
                "CHARA_PARTS_CLOTHES_MODEL_LIST_BEG",
                vec![
                    row(
                        "CHARA_PARTS_CLOTHES_MODEL",
                        vec![Int(1), CfgString("autre".into())],
                    ),
                    row("CHARA_PARTS_CLOTHES_MODEL_REF_INFO", vec![Int(0), Int(2)]),
                    row(
                        "CHARA_PARTS_CLOTHES_MODEL",
                        vec![Int(-268_409_599), CfgString("u011001_10".into())],
                    ),
                    row("CHARA_PARTS_CLOTHES_MODEL_REF_INFO", vec![Int(2), Int(2)]),
                ],
            ),
            list(
                "CHARA_PARTS_CLOTHES_INFO_LIST_BEG",
                vec![
                    row(
                        "CHARA_PARTS_CLOTHES_INFO",
                        vec![
                            CfgString("_uniform/u000101/u000101.g4md".into()),
                            CfgString("_uniform/u000101/u000101_10.g4tx".into()),
                            Int(0),
                        ],
                    ),
                    row(
                        "CHARA_PARTS_CLOTHES_INFO",
                        vec![
                            CfgString("_uniform/u000101/u000102.g4md".into()),
                            Int(0),
                            Int(1),
                        ],
                    ),
                    row(
                        "CHARA_PARTS_CLOTHES_INFO",
                        vec![
                            CfgString("_uniform/u011001/u011001.g4md".into()),
                            CfgString("_uniform/u011001/u011001_10.g4tx".into()),
                            Int(0),
                            CfgString("_uniform/n000101/n000101.g4md".into()),
                            CfgString("_uniform/n000101/n000101_10.g4tx".into()),
                            Int(-268_409_599),
                            CfgString("_uniform/sk000101/sk000101.g4md".into()),
                            CfgString("_uniform/sk000101/sk000101_10.g4tx".into()),
                            CfgString("_uniform/m011001/m011001.g4md".into()),
                            CfgString("_uniform/m011001/m011001_10.g4tx".into()),
                        ],
                    ),
                    row(
                        "CHARA_PARTS_CLOTHES_INFO",
                        vec![
                            CfgString("_uniform/u011001/u011002.g4md".into()),
                            Int(0),
                            Int(1),
                            CfgString("_uniform/n000101/n000102.g4md".into()),
                            Int(0),
                            Int(0),
                            CfgString("_uniform/sk000101/sk000102.g4md".into()),
                            Int(0),
                            CfgString("_uniform/m011001/m011002.g4md".into()),
                            Int(0),
                        ],
                    ),
                ],
            ),
            list(
                "CHARA_PARTS_SHOES_MODEL_LIST_BEG",
                vec![
                    // Les chaussures et les gants ne portent que le CRC (structure réelle).
                    row("CHARA_PARTS_SHOES_MODEL", vec![Int(0xFD1E_1546_u32 as i32)]),
                    row("CHARA_PARTS_SHOES_MODEL_REF_INFO", vec![Int(0), Int(2)]),
                ],
            ),
            list(
                "CHARA_PARTS_SHOES_INFO_LIST_BEG",
                vec![
                    row(
                        "CHARA_PARTS_SHOES_INFO",
                        vec![
                            CfgString("_uniform/s011001/s011001.g4md".into()),
                            CfgString("_uniform/s011001/s011001_10.g4tx".into()),
                            Int(0),
                        ],
                    ),
                    row(
                        "CHARA_PARTS_SHOES_INFO",
                        vec![
                            CfgString("_uniform/s011001/s011002.g4md".into()),
                            Int(0),
                            Int(1),
                        ],
                    ),
                ],
            ),
            list(
                "CHARA_PARTS_GLOVE_MODEL_LIST_BEG",
                vec![
                    row("CHARA_PARTS_GLOVE_MODEL", vec![Int(0xD35B_34D4_u32 as i32)]),
                    row("CHARA_PARTS_GLOVE_MODEL_REF_INFO", vec![Int(0), Int(1)]),
                ],
            ),
            list(
                "CHARA_PARTS_GLOVE_INFO_LIST_BEG",
                vec![row(
                    "CHARA_PARTS_GLOVE_INFO",
                    vec![
                        CfgString("_uniform/g000201/g000201.g4md".into()),
                        CfgString("_uniform/g000201/g011001_10.g4tx".into()),
                        Int(0),
                    ],
                )],
            ),
        ];
        CharacterPartsCatalog::from_entries(&entries, "test")
    }

    #[test]
    fn la_tenue_zeus_se_resout_par_crc_et_profil() {
        let cat = catalogue_zeus();
        assert_eq!(cat.clothes_code(0xF000_6501), Some("u011001_10"));
        let parts = cat.resolve_clothes(0xF000_6501, 0).expect("famille connue");
        let roles: Vec<&str> = parts.iter().map(|p| p.role).collect();
        assert_eq!(roles, vec!["uniform", "nameplate", "skin", "armband"]);
        assert_eq!(parts[0].g4md, "_uniform/u011001/u011001.g4md");
        assert_eq!(
            parts[0].g4tx.as_deref(),
            Some("_uniform/u011001/u011001_10.g4tx")
        );
        assert_eq!(parts[2].g4md, "_uniform/sk000101/sk000101.g4md");
        assert_eq!(
            parts[0].row_index, 2,
            "la référence pointe la bonne ligne INFO"
        );

        let shoes = cat.resolve_part("shoes", 0xFD1E_1546, 0).unwrap();
        assert_eq!(
            shoes.family, "s011001_10",
            "code déduit de la texture de tête"
        );
        assert_eq!(shoes.g4md, "_uniform/s011001/s011001.g4md");
        assert_eq!(
            shoes.g4tx.as_deref(),
            Some("_uniform/s011001/s011001_10.g4tx")
        );
        let gloves = cat.resolve_part("gloves", 0xD35B_34D4, 0).unwrap();
        assert_eq!(gloves.g4md, "_uniform/g000201/g000201.g4md");
        // Le modèle et la texture des gants sont de familles différentes : le catalogue le porte
        // tel quel, sans reconstruire un nom par convention.
        assert_eq!(
            gloves.g4tx.as_deref(),
            Some("_uniform/g000201/g011001_10.g4tx")
        );
    }

    #[test]
    fn un_profil_sans_texture_herite_de_la_ligne_de_tete() {
        let cat = catalogue_zeus();
        let parts = cat.resolve_clothes(0xF000_6501, 1).unwrap();
        assert_eq!(parts[0].g4md, "_uniform/u011001/u011002.g4md");
        assert_eq!(
            parts[0].g4tx.as_deref(),
            Some("_uniform/u011001/u011001_10.g4tx")
        );
        assert_eq!(parts[1].g4md, "_uniform/n000101/n000102.g4md");
        assert_eq!(
            parts[1].g4tx.as_deref(),
            Some("_uniform/n000101/n000101_10.g4tx")
        );
        assert_eq!(parts[0].profile_used, 1);

        let shoes = cat.resolve_part("shoes", 0xFD1E_1546, 1).unwrap();
        assert_eq!(shoes.g4md, "_uniform/s011001/s011002.g4md");
        assert_eq!(
            shoes.g4tx.as_deref(),
            Some("_uniform/s011001/s011001_10.g4tx")
        );
    }

    #[test]
    fn un_profil_inconnu_retombe_sur_le_profil_zero_et_le_dit() {
        let cat = catalogue_zeus();
        let gloves = cat.resolve_part("gloves", 0xD35B_34D4, 7).unwrap();
        assert_eq!(gloves.profile_requested, 7);
        assert_eq!(gloves.profile_used, 0);
        assert!(cat.resolve_clothes(0xDEAD_BEEF, 0).is_none());
        assert!(cat.resolve_part("shoes", 0, 0).is_none());
    }

    #[test]
    fn chara_model_relie_visage_corps_et_tenue_par_defaut() {
        let entries = vec![
            list(
                "CHARA_MODEL_INFO_LIST_BEG",
                vec![row(
                    "CHARA_MODEL_INFO",
                    vec![
                        Int(-1_359_951_174),
                        Int(0),
                        Int(0),
                        Int(0),
                        Int(613_579),
                        Int(-268_409_599),
                        Int(-819_431_484),
                        Int(0),
                        Int(0),
                        Int(11),
                        CfgString("_face/01_IE1/c01001900/c01001900.g4md".into()),
                    ],
                )],
            ),
            list(
                "CHARA_BODY_INFO_LIST_BEG",
                vec![row(
                    "CHARA_BODY_INFO",
                    vec![
                        Int(613_579),
                        CfgString("_common/c000101/c000101.objbin".into()),
                        CfgString("_uniform/sh000101/sh000101.g4md".into()),
                        Int(-646_744_094),
                        Int(0),
                        Int(0),
                        Int(0),
                    ],
                )],
            ),
        ];
        let cat = CharaModelCatalog::from_entries(&entries, "test");
        let row = cat.row("C01001900").expect("fiche Byron");
        assert_eq!(row.uniform_crc, 0xF000_6501);
        assert_eq!(
            row.shoes_crc,
            (-819_431_484_i32) as u32,
            "var[6] = chaussures par défaut"
        );
        assert_eq!(row.glove_crc, 0, "Byron n'a pas de gants par défaut");
        assert_eq!(
            row.face_g4md.as_deref(),
            Some("_face/01_IE1/c01001900/c01001900.g4md")
        );
        let body = cat.body(row).expect("corps");
        assert_eq!(body.skeleton_stem(), "c000101");
        assert_eq!(body.type_idx, 0);
    }
}
