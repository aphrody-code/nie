//! `niers find` et `niers grep` — recherche de fichiers et de contenu **sur le disque**.
//!
//! Complète `niers vfs find`, qui ne voit que l'intérieur des CPK du jeu. Ici c'est l'arbre de
//! travail : sources, dumps, scratchpad.
//!
//! ## Pourquoi dans la CLI plutôt qu'en shell
//!
//! Une question simple (« où est ce symbole ? », « quels fichiers portent cette extension ? »)
//! se payait jusqu'ici en chaînes `find | xargs grep | sort | uniq`, longues à écrire, lentes,
//! et pleines de pièges déjà rencontrés dans ce dépôt : `comm` exige `LC_ALL=C sort`,
//! `xargs wc -l` sous-compte (une ligne `total` par invocation), `git ls-files 'dir/**'` rate
//! les fichiers à la racine de `dir`. Une commande dédiée supprime la classe entière.
//!
//! ## Moteur
//!
//! [`ignore`] et [`grep_searcher`]/[`grep_regex`] — les bibliothèques qui *sont* ripgrep et fd.
//! Parcours parallèle, respect de `.gitignore`, recherche ligne à ligne sans allocation par
//! ligne. Rien de maison : le but est d'égaler l'outil de référence, pas de le réécrire.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_regex::RegexMatcher;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::{WalkBuilder, WalkState};

/// Construit l'ensemble de globs à partir des motifs `--glob` et des extensions `--ext`.
fn build_globset(globs: &[String], exts: &[String]) -> Result<Option<GlobSet>> {
    if globs.is_empty() && exts.is_empty() {
        return Ok(None);
    }
    let mut b = GlobSetBuilder::new();
    for g in globs {
        b.add(Glob::new(g).with_context(|| format!("glob invalide : {g}"))?);
    }
    for e in exts {
        let e = e.trim_start_matches('.');
        b.add(Glob::new(&format!("**/*.{e}")).with_context(|| format!("extension invalide : {e}"))?);
    }
    Ok(Some(b.build().context("construction du GlobSet")?))
}

/// Prépare un parcours : racine, fichiers cachés, respect de `.gitignore`, profondeur.
fn walker(
    dir: &Path,
    hidden: bool,
    no_ignore: bool,
    depth: Option<usize>,
) -> WalkBuilder {
    let mut w = WalkBuilder::new(dir);
    w.hidden(!hidden) // `hidden(true)` = **exclure** les cachés : on inverse le drapeau utilisateur.
        .git_ignore(!no_ignore)
        .git_global(!no_ignore)
        .git_exclude(!no_ignore)
        .ignore(!no_ignore)
        .parents(!no_ignore)
        .max_depth(depth);
    w
}

/// Options de `niers find`.
pub struct FindArgs {
    /// Sous-chaîne cherchée dans le chemin (vide = tout lister).
    pub pattern: String,
    /// Racine du parcours.
    pub dir: PathBuf,
    /// Motifs glob (`**/*.rs`) — cumulatifs avec `ext`.
    pub globs: Vec<String>,
    /// Extensions (`rs`, `.toml`) — sucre pour `**/*.<ext>`.
    pub exts: Vec<String>,
    /// `f` = fichiers seuls, `d` = répertoires seuls, sinon les deux.
    pub kind: Option<String>,
    /// Inclure les fichiers cachés.
    pub hidden: bool,
    /// Ignorer les règles `.gitignore`.
    pub no_ignore: bool,
    /// Profondeur maximale.
    pub depth: Option<usize>,
    /// Nombre maximal de résultats (0 = illimité).
    pub limit: usize,
    /// Sensible à la casse (défaut : insensible).
    pub case_sensitive: bool,
    /// N'afficher que le nombre de résultats.
    pub count: bool,
}

/// Cherche des fichiers par chemin. Renvoie le nombre de correspondances.
pub fn find(args: &FindArgs) -> Result<usize> {
    let set = build_globset(&args.globs, &args.exts)?;
    let needle = if args.case_sensitive {
        args.pattern.clone()
    } else {
        args.pattern.to_lowercase()
    };
    let only_files = args.kind.as_deref() == Some("f");
    let only_dirs = args.kind.as_deref() == Some("d");

    let hits: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::new(AtomicUsize::new(0));

    walker(&args.dir, args.hidden, args.no_ignore, args.depth)
        .build_parallel()
        .run(|| {
            let hits = Arc::clone(&hits);
            let seen = Arc::clone(&seen);
            let needle = needle.clone();
            let set = set.clone();
            Box::new(move |entry| {
                let Ok(e) = entry else { return WalkState::Continue };
                let is_dir = e.file_type().is_some_and(|t| t.is_dir());
                if (only_files && is_dir) || (only_dirs && !is_dir) {
                    return WalkState::Continue;
                }
                let path = e.path();
                // Un filtre de motif porte sur des FICHIERS. Un répertoire ne « match » jamais
                // `**/*.rs` : le rejeter d'un `is_match` couperait la descente, mais le laisser
                // passer le ferait LISTER — `--ext rs` rendait alors 717 entrées là où il y a
                // 608 fichiers. On le saute donc à l'émission, sans couper le parcours.
                if set.is_some() && is_dir {
                    return WalkState::Continue;
                }
                if let Some(s) = &set
                    && !s.is_match(path)
                {
                    return WalkState::Continue;
                }
                if !needle.is_empty() {
                    let hay = path.to_string_lossy();
                    let hay = if args_case(&needle) { hay.to_string() } else { hay.to_lowercase() };
                    if !hay.contains(&needle) {
                        return WalkState::Continue;
                    }
                }
                if args.limit > 0 && seen.fetch_add(1, Ordering::Relaxed) >= args.limit {
                    return WalkState::Quit;
                }
                if let Ok(mut v) = hits.lock() {
                    v.push(path.display().to_string());
                }
                WalkState::Continue
            })
        });

    let mut v = hits.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
    v.sort_unstable();
    let n = v.len();
    if args.count {
        println!("{n}");
        return Ok(n);
    }
    let out = std::io::stdout();
    let mut w = std::io::BufWriter::new(out.lock());
    for p in &v {
        writeln!(w, "{p}")?;
    }
    w.flush()?;
    Ok(n)
}

/// La casse est déjà normalisée en amont ; ce prédicat existe pour garder la closure lisible.
fn args_case(needle: &str) -> bool {
    needle.chars().any(char::is_uppercase)
}

/// Options de `niers grep`.
pub struct GrepArgs {
    /// Expression régulière cherchée dans le contenu.
    pub pattern: String,
    /// Racine du parcours.
    pub dir: PathBuf,
    /// Motifs glob restreignant les fichiers visités.
    pub globs: Vec<String>,
    /// Extensions restreignant les fichiers visités.
    pub exts: Vec<String>,
    /// Insensible à la casse.
    pub ignore_case: bool,
    /// Inclure les fichiers cachés.
    pub hidden: bool,
    /// Ignorer les règles `.gitignore`.
    pub no_ignore: bool,
    /// Nombre maximal de lignes affichées (0 = illimité).
    pub limit: usize,
    /// N'afficher que les chemins des fichiers qui contiennent au moins une correspondance.
    pub files_with_matches: bool,
}

/// Cherche un motif dans le contenu des fichiers. Renvoie le nombre de lignes correspondantes
/// (ou de fichiers en mode `files_with_matches`).
pub fn grep(args: &GrepArgs) -> Result<usize> {
    let set = build_globset(&args.globs, &args.exts)?;
    let matcher = RegexMatcher::new_line_matcher(&if args.ignore_case {
        format!("(?i){}", args.pattern)
    } else {
        args.pattern.clone()
    })
    .with_context(|| format!("expression régulière invalide : {}", args.pattern))?;

    let out: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::new(AtomicUsize::new(0));

    walker(&args.dir, args.hidden, args.no_ignore, None)
        .build_parallel()
        .run(|| {
            let out = Arc::clone(&out);
            let seen = Arc::clone(&seen);
            let matcher = matcher.clone();
            let set = set.clone();
            // `BinaryDetection::quit` évite de déverser des octets d'un CPK ou d'un .exe.
            let mut searcher = SearcherBuilder::new()
                .binary_detection(BinaryDetection::quit(0))
                .line_number(true)
                .build();
            Box::new(move |entry| {
                let Ok(e) = entry else { return WalkState::Continue };
                if !e.file_type().is_some_and(|t| t.is_file()) {
                    return WalkState::Continue;
                }
                let path = e.path();
                if let Some(s) = &set
                    && !s.is_match(path)
                {
                    return WalkState::Continue;
                }
                let mut file_hits = 0usize;
                let display = path.display().to_string();
                let res = searcher.search_path(
                    &matcher,
                    path,
                    UTF8(|lineno, line| {
                        file_hits += 1;
                        if !args.files_with_matches {
                            if args.limit > 0 && seen.fetch_add(1, Ordering::Relaxed) >= args.limit
                            {
                                return Ok(false);
                            }
                            if let Ok(mut v) = out.lock() {
                                v.push(format!("{display}:{lineno}:{}", line.trim_end()));
                            }
                        }
                        Ok(true)
                    }),
                );
                // Un fichier illisible (permission, lien cassé) ne doit pas arrêter la recherche.
                if res.is_ok() && args.files_with_matches && file_hits > 0 {
                    if args.limit > 0 && seen.fetch_add(1, Ordering::Relaxed) >= args.limit {
                        return WalkState::Quit;
                    }
                    if let Ok(mut v) = out.lock() {
                        v.push(display);
                    }
                }
                WalkState::Continue
            })
        });

    let mut v = out.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
    v.sort_unstable();
    let n = v.len();
    let stdout = std::io::stdout();
    let mut w = std::io::BufWriter::new(stdout.lock());
    for line in &v {
        writeln!(w, "{line}")?;
    }
    w.flush()?;
    Ok(n)
}
