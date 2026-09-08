//! Ingestion du catalogue de formats exporté par iecode (`iecode export-knowledge`).
//!
//! iecode (C# .NET 10) ne peut pas être appelé depuis niers (full-Rust). Il publie
//! donc son savoir sur les formats binaires LEVEL-5 / CRIWARE d'IEVR sous forme d'un
//! artefact JSON stable et versionné, produit par :
//!
//! ```sh
//! iecode export-knowledge --out <catalogue.json>
//! ```
//!
//! Ce module lit ce JSON et l'ingère comme ancres de vérité :
//! - chaque format → table `format` (via [`nie_index::ingest::format`]) ;
//! - chaque champ d'en-tête documenté → table `format_field` (offset/taille/type/nom/note).
//!
//! ## Schéma JSON attendu (schema_version 1)
//!
//! ```json
//! {
//!   "schema_version": 1,
//!   "generator": "iecode",
//!   "game": "Inazuma Eleven: Victory Road",
//!   "format_count": 31,
//!   "formats": [
//!     {
//!       "name": "G4TX",
//!       "category": "Texture",
//!       "extensions": ["g4tx"],
//!       "magic": "\"G4TX\"",
//!       "magic_hex": 1481913415,
//!       "endianness": "Little",
//!       "header_size": 96,
//!       "description": "Conteneur de textures LEVEL-5 …",
//!       "doc": "Formats/Level5/G4txParser.cs",
//!       "fields": [
//!         { "offset": 0, "size": 4, "type": "magic", "name": "Magic", "note": "\"G4TX\" …" }
//!       ]
//!     }
//!   ]
//! }
//! ```
//!
//! Contrairement à [`crate::formats`] (catalogue minimal codé en dur : nom + magic),
//! ce module récupère le savoir COMPLET d'iecode, y compris le layout des champs
//! d'en-tête, sans dupliquer la connaissance dans le code Rust.

#[cfg(feature = "host")]
use std::path::Path;

#[cfg(feature = "host")]
use anyhow::{Context, Result, bail};
#[cfg(feature = "host")]
use nie_index::{Db, ingest};
use serde::{Deserialize, Serialize};
use thiserror::Error;
#[cfg(feature = "host")]
use tracing::debug;

/// Version de schéma supportée par cet ingesteur. Doit correspondre au
/// `schema_version` produit par `iecode export-knowledge`.
pub const SUPPORTED_SCHEMA_VERSION: i64 = 1;

/// Resource limits applied while parsing an exported format catalog.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatalogLimits {
    /// Maximum accepted JSON payload size in bytes.
    pub max_input_bytes: usize,
    /// Maximum number of format entries.
    pub max_formats: usize,
    /// Maximum number of fields in one format entry.
    pub max_fields_per_format: usize,
    /// Maximum number of filename extensions in one format entry.
    pub max_extensions_per_format: usize,
    /// Maximum number of fields across the complete catalog.
    pub max_total_fields: usize,
    /// Maximum UTF-8 byte length of any retained string.
    pub max_string_bytes: usize,
}

impl Default for CatalogLimits {
    fn default() -> Self {
        Self {
            max_input_bytes: 2 * 1024 * 1024,
            max_formats: 256,
            max_fields_per_format: 512,
            max_extensions_per_format: 64,
            max_total_fields: 8_192,
            max_string_bytes: 16 * 1024,
        }
    }
}

/// A validated machine-readable format catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormatCatalog {
    /// Catalog schema version.
    pub schema_version: i64,
    /// Name of the catalog generator, when provided.
    #[serde(default)]
    pub generator: String,
    /// Game identifier supplied by the catalog producer, when provided.
    #[serde(default)]
    pub game: Option<String>,
    /// Number of formats declared by the producer, when provided.
    #[serde(default)]
    pub format_count: Option<usize>,
    /// Format entries in producer order.
    #[serde(default)]
    pub formats: Vec<FormatEntry>,
}

impl FormatCatalog {
    /// Find a format by its exact canonical name.
    #[must_use]
    pub fn format(&self, name: &str) -> Option<&FormatEntry> {
        self.formats.iter().find(|format| format.name == name)
    }

    /// Count all documented header fields in the catalog.
    #[must_use]
    pub fn total_fields(&self) -> usize {
        self.formats.iter().map(|format| format.fields.len()).sum()
    }
}

/// One format definition from the exported catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormatEntry {
    /// Canonical format name, for example `G4TX`, `G4MG`, or `cfg.bin`.
    pub name: String,
    /// Producer-defined format category.
    #[serde(default)]
    pub category: Option<String>,
    /// VFS filename extensions associated with this format.
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Human-readable magic representation, when the format has one.
    #[serde(default)]
    pub magic: Option<String>,
    /// Numeric magic representation emitted by the producer.
    #[serde(default)]
    pub magic_hex: Option<u64>,
    /// Producer-defined byte order.
    #[serde(default)]
    pub endianness: Option<String>,
    /// Documented header size in bytes.
    #[serde(default)]
    pub header_size: Option<u64>,
    /// Human-readable format description.
    #[serde(default)]
    pub description: Option<String>,
    /// Source document or parser path.
    #[serde(default)]
    pub doc: Option<String>,
    /// Documented header fields.
    #[serde(default)]
    pub fields: Vec<FieldEntry>,
}

/// One documented field in a format header.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldEntry {
    /// Byte offset, when known.
    #[serde(default)]
    pub offset: Option<i64>,
    /// Field size in bytes, when known.
    #[serde(default)]
    pub size: Option<i64>,
    /// Producer-defined field type.
    #[serde(rename = "type")]
    #[serde(default)]
    pub ty: Option<String>,
    /// Field name.
    pub name: String,
    /// Optional field note.
    #[serde(default)]
    pub note: Option<String>,
}

/// Failure returned by [`parse_format_catalog_bytes`].
#[derive(Debug, Error)]
pub enum CatalogParseError {
    /// The JSON payload exceeded the configured byte limit.
    #[error("catalog input is {actual} bytes; limit is {limit} bytes")]
    InputTooLarge { actual: usize, limit: usize },
    /// The payload was not valid catalog JSON.
    #[error("invalid format catalog JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    /// The payload uses a schema this crate cannot interpret safely.
    #[error("unsupported schema_version {actual}; expected {expected}")]
    UnsupportedSchema { actual: i64, expected: i64 },
    /// The payload contained more formats than allowed.
    #[error("catalog contains {actual} formats; limit is {limit}")]
    TooManyFormats { actual: usize, limit: usize },
    /// One format contained more fields than allowed.
    #[error("format {format_name:?} contains {actual} fields; limit is {limit}")]
    TooManyFields {
        format_name: String,
        actual: usize,
        limit: usize,
    },
    /// One format contained more filename extensions than allowed.
    #[error("format {format_name:?} contains {actual} extensions; limit is {limit}")]
    TooManyExtensions {
        format_name: String,
        actual: usize,
        limit: usize,
    },
    /// The total field count exceeded the configured limit.
    #[error("catalog contains more than {limit} fields")]
    TooManyTotalFields { limit: usize },
    /// A required format or field name was empty.
    #[error("{location} must not be empty")]
    EmptyName { location: String },
    /// A retained string exceeded the configured limit.
    #[error("{location} is {actual} bytes; string limit is {limit} bytes")]
    StringTooLong {
        location: String,
        actual: usize,
        limit: usize,
    },
}

/// Parse and validate an exported iecode format catalog from bytes.
///
/// The input-size check happens before JSON allocation. Limits on entries, fields,
/// and strings are then enforced before the catalog is returned to a caller such
/// as a WebAssembly binding.
///
/// # Errors
///
/// Returns [`CatalogParseError`] for invalid JSON, unsupported schemas, or any
/// configured resource limit violation.
pub fn parse_format_catalog_bytes(
    bytes: &[u8],
    limits: CatalogLimits,
) -> Result<FormatCatalog, CatalogParseError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(CatalogParseError::InputTooLarge {
            actual: bytes.len(),
            limit: limits.max_input_bytes,
        });
    }

    let catalog: FormatCatalog = serde_json::from_slice(bytes)?;
    validate_catalog(&catalog, limits)?;
    Ok(catalog)
}

fn validate_catalog(
    catalog: &FormatCatalog,
    limits: CatalogLimits,
) -> Result<(), CatalogParseError> {
    if catalog.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(CatalogParseError::UnsupportedSchema {
            actual: catalog.schema_version,
            expected: SUPPORTED_SCHEMA_VERSION,
        });
    }
    if catalog.formats.len() > limits.max_formats {
        return Err(CatalogParseError::TooManyFormats {
            actual: catalog.formats.len(),
            limit: limits.max_formats,
        });
    }

    check_string("generator", &catalog.generator, limits.max_string_bytes)?;
    check_optional_string("game", catalog.game.as_deref(), limits)?;
    let mut total_fields = 0usize;
    for format in &catalog.formats {
        check_required_name("format name", &format.name, limits.max_string_bytes)?;
        check_optional_string("format category", format.category.as_deref(), limits)?;
        check_optional_string("format magic", format.magic.as_deref(), limits)?;
        check_optional_string("format endianness", format.endianness.as_deref(), limits)?;
        check_optional_string("format description", format.description.as_deref(), limits)?;
        check_optional_string("format document", format.doc.as_deref(), limits)?;
        if format.extensions.len() > limits.max_extensions_per_format {
            return Err(CatalogParseError::TooManyExtensions {
                format_name: format.name.clone(),
                actual: format.extensions.len(),
                limit: limits.max_extensions_per_format,
            });
        }
        for extension in &format.extensions {
            check_string("format extension", extension, limits.max_string_bytes)?;
        }

        if format.fields.len() > limits.max_fields_per_format {
            return Err(CatalogParseError::TooManyFields {
                format_name: format.name.clone(),
                actual: format.fields.len(),
                limit: limits.max_fields_per_format,
            });
        }
        total_fields = total_fields.saturating_add(format.fields.len());
        if total_fields > limits.max_total_fields {
            return Err(CatalogParseError::TooManyTotalFields {
                limit: limits.max_total_fields,
            });
        }

        for field in &format.fields {
            check_required_name("field name", &field.name, limits.max_string_bytes)?;
            check_optional_string("field type", field.ty.as_deref(), limits)?;
            check_optional_string("field note", field.note.as_deref(), limits)?;
        }
    }
    Ok(())
}

fn check_required_name(
    location: &str,
    value: &str,
    max_string_bytes: usize,
) -> Result<(), CatalogParseError> {
    if value.trim().is_empty() {
        return Err(CatalogParseError::EmptyName {
            location: location.to_owned(),
        });
    }
    check_string(location, value, max_string_bytes)
}

fn check_optional_string(
    location: &str,
    value: Option<&str>,
    limits: CatalogLimits,
) -> Result<(), CatalogParseError> {
    if let Some(value) = value {
        check_string(location, value, limits.max_string_bytes)?;
    }
    Ok(())
}

fn check_string(
    location: &str,
    value: &str,
    max_string_bytes: usize,
) -> Result<(), CatalogParseError> {
    if value.len() > max_string_bytes {
        return Err(CatalogParseError::StringTooLong {
            location: location.to_owned(),
            actual: value.len(),
            limit: max_string_bytes,
        });
    }
    Ok(())
}

/// Résultat d'une passe d'ingestion du catalogue.
#[derive(Debug, Default, Clone, Copy)]
pub struct CatalogStats {
    /// Nombre de formats insérés/mis à jour.
    pub formats: usize,
    /// Nombre de champs d'en-tête insérés.
    pub fields: usize,
}

/// Ingère le catalogue de formats iecode depuis le fichier JSON `path`.
///
/// Source déclarée pour les formats : `"iecode-catalog"` (distincte de la source
/// `"iecode"` du catalogue minimal codé en dur dans [`crate::formats`], pour tracer
/// l'origine machine-readable).
///
/// L'opération est idempotente : ré-ingérer le même catalogue ne crée pas de doublon
/// de format (`ON CONFLICT(name)`), mais purge et réinsère les champs de chaque format
/// pour rester aligné sur la dernière version exportée.
///
/// # Erreurs
///
/// Retourne une erreur si le fichier est introuvable/illisible, si le JSON est
/// invalide, ou si la `schema_version` n'est pas supportée.
#[cfg(feature = "host")]
pub fn ingest_format_catalog(db: &mut Db, path: &Path) -> Result<CatalogStats> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("lecture du catalogue iecode : {}", path.display()))?;

    let doc: FormatCatalog = serde_json::from_str(&raw)
        .with_context(|| format!("JSON invalide : {}", path.display()))?;

    if doc.schema_version != SUPPORTED_SCHEMA_VERSION {
        bail!(
            "schema_version {} non supportée (attendu {SUPPORTED_SCHEMA_VERSION}) — \
             mettre à jour nie-seed::format_catalog",
            doc.schema_version
        );
    }

    debug!(
        "catalogue iecode : generator={} formats={}",
        doc.generator,
        doc.formats.len()
    );

    let tx = db
        .conn_mut()
        .transaction()
        .context("ouverture de transaction format_catalog")?;

    let mut stats = CatalogStats::default();

    for fmt in &doc.formats {
        let format_id = ingest::format(
            &tx,
            &fmt.name,
            fmt.magic.as_deref(),
            "iecode-catalog",
            fmt.doc.as_deref(),
        )
        .with_context(|| format!("ingest format({})", fmt.name))?;
        stats.formats += 1;

        // Purge les champs existants de ce format puis réinsère (idempotence
        // sur ré-export). La table format_field n'a pas de contrainte d'unicité.
        tx.execute("DELETE FROM format_field WHERE format_id = ?1", [format_id])
            .with_context(|| format!("purge format_field({})", fmt.name))?;

        for field in &fmt.fields {
            tx.execute(
                "INSERT INTO format_field(format_id, offset, size, ty, name, note)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    format_id,
                    field.offset,
                    field.size,
                    field.ty.as_deref(),
                    field.name,
                    field.note.as_deref(),
                ],
            )
            .with_context(|| format!("insert format_field({}.{})", fmt.name, field.name))?;
            stats.fields += 1;
        }

        debug!(
            "format catalogue : {} (id={format_id}, {} champs)",
            fmt.name,
            fmt.fields.len()
        );
    }

    tx.commit().context("commit format_catalog")?;
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(feature = "host")]
    use std::io::Write;

    /// Écrit un catalogue JSON minimal dans un fichier temporaire et renvoie son chemin.
    #[cfg(feature = "host")]
    fn write_catalog(json: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "nie-seed-catalog-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        path.push(unique);
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(json.as_bytes()).unwrap();
        path
    }

    const SAMPLE: &str = r#"{
        "schema_version": 1,
        "generator": "iecode",
        "game": "Inazuma Eleven: Victory Road",
        "format_count": 2,
        "formats": [
            {
                "name": "G4TX",
                "category": "Texture",
                "extensions": ["g4tx"],
                "magic": "\"G4TX\"",
                "magic_hex": 1481913415,
                "endianness": "Little",
                "header_size": 96,
                "description": "Conteneur de textures LEVEL-5",
                "doc": "Formats/Level5/G4txParser.cs",
                "fields": [
                    { "offset": 0, "size": 4, "type": "magic", "name": "Magic", "note": "G4TX" },
                    { "offset": 4, "size": 2, "type": "i16", "name": "HeaderSize" }
                ]
            },
            {
                "name": "cfg.bin",
                "category": "Config",
                "extensions": ["cfg.bin"],
                "magic": null,
                "endianness": "Little",
                "description": "Configuration binaire LEVEL-5",
                "doc": "Formats/Level5/CfgBin/CfgBin.cs",
                "fields": []
            }
        ]
    }"#;

    #[test]
    fn parses_bounded_catalog_from_bytes() {
        let catalog =
            parse_format_catalog_bytes(SAMPLE.as_bytes(), CatalogLimits::default()).unwrap();

        assert_eq!(catalog.schema_version, SUPPORTED_SCHEMA_VERSION);
        assert_eq!(catalog.generator, "iecode");
        assert_eq!(
            catalog.game.as_deref(),
            Some("Inazuma Eleven: Victory Road")
        );
        assert_eq!(catalog.format_count, Some(2));
        assert_eq!(catalog.formats.len(), 2);
        assert_eq!(catalog.total_fields(), 2);

        let g4tx = catalog.format("G4TX").expect("G4TX entry");
        assert_eq!(g4tx.extensions, ["g4tx"]);
        assert_eq!(g4tx.magic.as_deref(), Some("\"G4TX\""));
        assert_eq!(g4tx.magic_hex, Some(1_481_913_415));
        assert_eq!(g4tx.header_size, Some(96));
        assert_eq!(g4tx.fields[1].name, "HeaderSize");
        assert_eq!(g4tx.fields[1].ty.as_deref(), Some("i16"));

        let cfg = catalog.format("cfg.bin").expect("cfg.bin entry");
        assert_eq!(cfg.magic, None);
        assert!(cfg.fields.is_empty());
    }

    #[test]
    fn rejects_input_before_json_allocation_limit() {
        let limits = CatalogLimits {
            max_input_bytes: SAMPLE.len() - 1,
            ..CatalogLimits::default()
        };
        let error = parse_format_catalog_bytes(SAMPLE.as_bytes(), limits).unwrap_err();
        assert!(matches!(error, CatalogParseError::InputTooLarge { .. }));
    }

    #[test]
    fn rejects_entry_and_string_limits() {
        let format_limits = CatalogLimits {
            max_formats: 1,
            ..CatalogLimits::default()
        };
        let error = parse_format_catalog_bytes(SAMPLE.as_bytes(), format_limits).unwrap_err();
        assert!(matches!(error, CatalogParseError::TooManyFormats { .. }));

        let field_limits = CatalogLimits {
            max_fields_per_format: 1,
            ..CatalogLimits::default()
        };
        let error = parse_format_catalog_bytes(SAMPLE.as_bytes(), field_limits).unwrap_err();
        assert!(matches!(error, CatalogParseError::TooManyFields { .. }));

        let string_limits = CatalogLimits {
            max_string_bytes: 3,
            ..CatalogLimits::default()
        };
        let error = parse_format_catalog_bytes(SAMPLE.as_bytes(), string_limits).unwrap_err();
        assert!(matches!(error, CatalogParseError::StringTooLong { .. }));
    }

    #[test]
    fn rejects_unsupported_schema_and_empty_names() {
        let unsupported = br#"{ "schema_version": 999, "formats": [] }"#;
        let error = parse_format_catalog_bytes(unsupported, CatalogLimits::default()).unwrap_err();
        assert!(matches!(
            error,
            CatalogParseError::UnsupportedSchema { actual: 999, .. }
        ));

        let empty_name = br#"{
            "schema_version": 1,
            "formats": [{ "name": " ", "fields": [] }]
        }"#;
        let error = parse_format_catalog_bytes(empty_name, CatalogLimits::default()).unwrap_err();
        assert!(matches!(error, CatalogParseError::EmptyName { .. }));
    }

    #[test]
    #[cfg(feature = "host")]
    fn ingest_sample_catalogue() {
        let path = write_catalog(SAMPLE);
        let mut db = Db::open_in_memory().unwrap();
        let stats = ingest_format_catalog(&mut db, &path).unwrap();
        assert_eq!(stats.formats, 2, "deux formats attendus");
        assert_eq!(stats.fields, 2, "deux champs attendus (G4TX)");

        // Le format G4TX est présent et ses champs aussi.
        let n_g4tx: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM format WHERE name='G4TX'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(n_g4tx, 1);

        let n_fields: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM format_field ff
                 JOIN format f ON f.id = ff.format_id WHERE f.name='G4TX'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n_fields, 2);

        // Source machine-readable correctement tracée.
        let src: String = db
            .conn()
            .query_row("SELECT source FROM format WHERE name='G4TX'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(src, "iecode-catalog");

        std::fs::remove_file(&path).ok();
    }

    #[test]
    #[cfg(feature = "host")]
    fn ingest_is_idempotent() {
        let path = write_catalog(SAMPLE);
        let mut db = Db::open_in_memory().unwrap();
        let s1 = ingest_format_catalog(&mut db, &path).unwrap();
        let s2 = ingest_format_catalog(&mut db, &path).unwrap();
        assert_eq!(s1.formats, s2.formats);
        assert_eq!(s1.fields, s2.fields);

        // Pas de doublon de format ni de champ après deux passes.
        let n_fmt: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM format", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n_fmt, 2);

        let n_field: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM format_field", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n_field, 2, "les champs ne doivent pas se dupliquer");

        std::fs::remove_file(&path).ok();
    }

    #[test]
    #[cfg(feature = "host")]
    fn rejette_schema_version_inconnue() {
        let path = write_catalog(r#"{ "schema_version": 999, "formats": [] }"#);
        let mut db = Db::open_in_memory().unwrap();
        let err = ingest_format_catalog(&mut db, &path).unwrap_err();
        assert!(
            err.to_string().contains("schema_version"),
            "l'erreur doit mentionner schema_version : {err}"
        );
        std::fs::remove_file(&path).ok();
    }
}
