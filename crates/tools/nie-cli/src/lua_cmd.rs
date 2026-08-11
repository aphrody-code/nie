//! `niers lua` — analyse statique des sources Lua, fichier isolé ou arborescence.
//!
//! L'analyse elle-même n'est pas ici : elle vient de [`nie_lua::static_analysis`], partagée
//! avec le reste du moteur. Ce module ne fait que le parcours d'entrée et le rendu en lignes
//! `clé=valeur`.
//!
//! Chaque ligne de détail répète le chemin du fichier : c'est ce qui rend la sortie
//! exploitable au `grep` quand l'entrée est une arborescence de plusieurs centaines de
//! scripts, où un en-tête par fichier serait perdu à la première redirection.

use std::path::Path;

use anyhow::{Context, bail};

/// Rubriques de détail demandées en plus de la ligne de synthèse.
#[derive(Debug, Clone, Copy)]
pub struct Detail {
    /// Détaille les fonctions déclarées.
    pub functions: bool,
    /// Détaille les cibles d'appel, agrégées par fréquence.
    pub calls: bool,
    /// Détaille les chaînes littérales retenues.
    pub strings: bool,
    /// Détaille les chaînes passées à `CRC32`, avec leur hash.
    pub crc32: bool,
    /// Nombre maximal de lignes par rubrique et par fichier ; `0` = illimité.
    pub limit: usize,
}

impl Detail {
    /// Borne un nombre d'éléments par [`Self::limit`].
    fn take(self, total: usize) -> usize {
        if self.limit == 0 {
            total
        } else {
            total.min(self.limit)
        }
    }
}

/// Compteurs cumulés sur une arborescence.
#[derive(Default)]
struct Totals {
    files: usize,
    valid: usize,
    functions: usize,
    calls: usize,
    tables: usize,
    strings: usize,
    crc32: usize,
    errors: usize,
}

/// Analyse un fichier `.lua` ou une arborescence et rend le résultat sur la sortie standard.
///
/// # Erreurs
/// Si `src` n'existe pas, si un fichier isolé n'est pas lisible, ou si une arborescence ne
/// contient aucun `.lua`.
pub fn run(src: &Path, detail: Detail) -> anyhow::Result<()> {
    if src.is_dir() {
        let files = nie_lua::static_analysis::collect_lua_files(src);
        if files.is_empty() {
            bail!("aucun fichier .lua sous {}", src.display());
        }
        let mut totals = Totals::default();
        for path in &files {
            // Un fichier illisible ne doit pas annuler le lot : on le signale et on continue.
            match nie_lua::static_analysis::analyze_file(path) {
                Ok(a) => report(&a, path, detail, &mut totals),
                Err(e) => println!("lua={} ok=false reason={e}", path.display()),
            }
        }
        println!(
            "lua-total={} files={} valid={} functions={} calls={} tables={} strings={} \
             crc32={} errors={}",
            src.display(),
            totals.files,
            totals.valid,
            totals.functions,
            totals.calls,
            totals.tables,
            totals.strings,
            totals.crc32,
            totals.errors,
        );
        return Ok(());
    }

    let analysis = nie_lua::static_analysis::analyze_file(src)
        .with_context(|| format!("analyse de {}", src.display()))?;
    let mut totals = Totals::default();
    report(&analysis, src, detail, &mut totals);
    Ok(())
}

/// Écrit la synthèse d'un fichier, puis les rubriques de détail demandées.
fn report(
    a: &nie_lua::static_analysis::LuaAnalysis,
    path: &Path,
    detail: Detail,
    totals: &mut Totals,
) {
    let path = path.display();
    println!(
        "lua={path} ok={} lines={} functions={} calls={} assignments={} tables={} \
         strings={} crc32={} errors={}",
        a.is_valid(),
        a.line_count,
        a.functions.len(),
        a.calls.len(),
        a.assignments.len(),
        a.tables.len(),
        a.strings.len(),
        a.crc32_strings.len(),
        a.errors.len(),
    );

    totals.files += 1;
    totals.valid += usize::from(a.is_valid());
    totals.functions += a.functions.len();
    totals.calls += a.calls.len();
    totals.tables += a.tables.len();
    totals.strings += a.strings.len();
    totals.crc32 += a.crc32_strings.len();
    totals.errors += a.errors.len();

    // Les erreurs sortent sans qu'on les demande : c'est le seul résultat qui invalide
    // tout le reste de l'analyse, le taire par défaut serait trompeur.
    for e in a.errors.iter().take(detail.take(a.errors.len())) {
        println!(
            "error={path} line={} col={} kind={} text={}",
            e.line,
            e.column,
            e.kind.label(),
            e.text
        );
    }

    if detail.functions {
        for f in a.functions.iter().take(detail.take(a.functions.len())) {
            println!(
                "function={path} name={} kind={} params={} lines={}-{}",
                if f.name.is_empty() { "-" } else { &f.name },
                f.kind.label(),
                if f.params.is_empty() {
                    "-".to_string()
                } else {
                    f.params.join(",")
                },
                f.start_line,
                f.end_line,
            );
        }
    }

    if detail.calls {
        let counts = a.call_counts();
        for (name, n) in counts.iter().take(detail.take(counts.len())) {
            println!("call={path} name={name} count={n}");
        }
    }

    if detail.strings {
        for s in a.strings.iter().take(detail.take(a.strings.len())) {
            println!("string={path} value={s}");
        }
    }

    if detail.crc32 {
        for s in a
            .crc32_strings
            .iter()
            .take(detail.take(a.crc32_strings.len()))
        {
            // Le moteur adresse ces noms par leur hash : sans lui, la chaîne ne se
            // raccorde à rien dans les données binaires.
            println!(
                "crc32={path} value={s} hash=0x{:08X}",
                nie_formats::cfgbin::crc32(s.as_bytes())
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_limite_zero_ne_borne_rien() {
        let d = Detail {
            functions: false,
            calls: false,
            strings: false,
            crc32: false,
            limit: 0,
        };
        assert_eq!(d.take(5000), 5000);
    }

    #[test]
    fn la_limite_borne_le_detail() {
        let d = Detail {
            functions: true,
            calls: false,
            strings: false,
            crc32: false,
            limit: 3,
        };
        assert_eq!(d.take(100), 3);
        // Une rubrique plus courte que la limite n'est pas allongée.
        assert_eq!(d.take(2), 2);
    }

    #[test]
    fn un_repertoire_sans_lua_est_une_erreur() {
        let dir = std::env::temp_dir().join("niers-lua-vide");
        let _ = std::fs::create_dir_all(&dir);
        let d = Detail {
            functions: false,
            calls: false,
            strings: false,
            crc32: false,
            limit: 1,
        };
        assert!(run(&dir, d).is_err());
    }
}
