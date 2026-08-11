//! Analyse **statique** de sources Lua : AST concret tree-sitter, sans jamais exécuter le code.
//!
//! Complément du reste de la crate, qui exécute le bytecode `.lua.bin` dans la VM réelle. Ici
//! on travaille sur du **texte** Lua — les scripts décompilés (`data/lua_scripts/decompiled/`)
//! — pour en tirer la structure : fonctions déclarées, appels, chaînes, et les erreurs de
//! syntaxe que le décompilateur a pu laisser derrière lui.
//!
//! ## Pourquoi tree-sitter
//!
//! La grammaire produit un arbre même sur une source cassée : les zones illisibles deviennent
//! des nœuds `ERROR`/`MISSING` et le reste reste exploitable. Un parseur strict rendrait une
//! erreur et rien d'autre, ce qui est exactement l'inverse du besoin sur une sortie de
//! décompilateur.
//!
//! ## Résolution des alias du décompilateur
//!
//! Les scripts décompilés sont en forme « machine à registres » : le nom réel de la cible
//! d'un appel n'apparaît jamais sur le site d'appel.
//!
//! ```lua
//! L2_1 = CRC32
//! L3_1 = "chara_filter_menu_tab_text_element"
//! L2_1 = L2_1(L3_1)
//! ```
//!
//! Une lecture littérale rapporterait un appel à `L2_1` avec un argument `L3_1` — inutilisable.
//! L'analyse propage donc les liaisons simples (`registre = nom`, `registre = "chaîne"`) en
//! ordre de source, ce qui restitue `CRC32("chara_filter_menu_tab_text_element")`. La liaison
//! n'est enregistrée qu'**après** la traversée du membre droit, sinon `L2_1 = L2_1(...)`
//! écraserait l'alias avant que l'appel ne soit lu.
//!
//! La propagation est volontairement à plat (pas de portées) : la sortie du décompilateur est
//! du code linéaire, et sur du Lua écrit à la main une liaison non résolue retombe simplement
//! sur le texte source, jamais sur un résultat faux silencieux.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use thiserror::Error;
use tree_sitter::{Node, Parser};

/// Erreurs de l'analyse statique.
#[derive(Debug, Error)]
pub enum StaticAnalysisError {
    /// La grammaire Lua a été refusée par le runtime tree-sitter (désaccord d'ABI).
    #[error("grammaire Lua refusée par tree-sitter : {0}")]
    Language(#[from] tree_sitter::LanguageError),
    /// tree-sitter n'a rendu aucun arbre (source démesurée ou annulation).
    #[error("tree-sitter n'a produit aucun arbre")]
    NoTree,
    /// Un fichier ou un répertoire n'a pas pu être lu.
    #[error("lecture de {path} impossible")]
    Io {
        /// Chemin fautif.
        path: PathBuf,
        /// Cause système.
        #[source]
        source: std::io::Error,
    },
}

/// Nature d'une déclaration de fonction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FunctionKind {
    /// `function f()` ou `function t.f()` — visible depuis l'extérieur du chunk.
    Global,
    /// `local function f()` — confinée au chunk.
    Local,
    /// `function t:f()` — reçoit `self` implicitement.
    Method,
    /// `function()` sans nom ; [`LuaFunction::name`] porte alors la cible d'affectation
    /// déduite (`t.cb = function() … end` → `t.cb`) ou reste vide.
    Anonymous,
}

impl FunctionKind {
    /// Étiquette courte et stable, destinée à une sortie `clé=valeur`.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Local => "local",
            Self::Method => "method",
            Self::Anonymous => "anonymous",
        }
    }
}

/// Fonction déclarée dans la source.
#[derive(Debug, Clone)]
pub struct LuaFunction {
    /// Nom déclaré (`f`, `t.f`, `t:f`) ; vide pour une anonyme non affectée.
    pub name: String,
    /// Nature de la déclaration.
    pub kind: FunctionKind,
    /// Paramètres formels, `...` compris.
    pub params: Vec<String>,
    /// Première ligne (base 1).
    pub start_line: u32,
    /// Dernière ligne (base 1).
    pub end_line: u32,
}

/// Site d'appel de fonction.
#[derive(Debug, Clone)]
pub struct LuaCall {
    /// Cible telle qu'écrite sur le site d'appel (`L2_1`, `t.f`, `obj:m`).
    pub callee: String,
    /// Cible après propagation des alias, quand elle diffère de [`Self::callee`].
    pub resolved: Option<String>,
    /// Nombre d'arguments passés.
    pub arg_count: usize,
    /// Arguments qui sont des chaînes littérales, ou des alias résolus vers une chaîne.
    pub string_args: Vec<String>,
    /// Ligne de l'appel (base 1).
    pub line: u32,
}

impl LuaCall {
    /// Meilleur nom connu de la cible : la forme résolue si elle existe, sinon le texte source.
    #[must_use]
    pub fn name(&self) -> &str {
        self.resolved.as_deref().unwrap_or(&self.callee)
    }
}

/// Nature d'un nœud `ERROR` de la grammaire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyntaxErrorKind {
    /// Fragment que la grammaire n'a pas su rattacher (nœud `ERROR`).
    Unparsable,
    /// Jeton attendu et absent, inséré par la récupération d'erreur (nœud `MISSING`).
    Missing,
}

impl SyntaxErrorKind {
    /// Étiquette courte et stable, destinée à une sortie `clé=valeur`.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::Unparsable => "unparsable",
            Self::Missing => "missing",
        }
    }
}

/// Erreur de syntaxe localisée.
#[derive(Debug, Clone)]
pub struct LuaSyntaxError {
    /// Nature du nœud fautif.
    pub kind: SyntaxErrorKind,
    /// Ligne (base 1).
    pub line: u32,
    /// Colonne (base 1).
    pub column: u32,
    /// Extrait de source fautif, tronqué ; pour un `MISSING` c'est le jeton attendu.
    pub text: String,
}

/// Classe de la valeur affectée, telle que le nœud de l'AST la donne.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueKind {
    /// Chaîne littérale.
    Str,
    /// Littéral numérique.
    Number,
    /// `true` / `false`.
    Bool,
    /// `nil`.
    Nil,
    /// Constructeur de table `{ … }`.
    Table,
    /// `function() … end`.
    Function,
    /// Résultat d'un appel.
    Call,
    /// Référence à une autre variable / champ.
    Reference,
    /// Tout le reste (opérations, `...`, parenthèses).
    Other,
}

impl ValueKind {
    /// Étiquette courte et stable, destinée à une sortie `clé=valeur`.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::Str => "string",
            Self::Number => "number",
            Self::Bool => "bool",
            Self::Nil => "nil",
            Self::Table => "table",
            Self::Function => "function",
            Self::Call => "call",
            Self::Reference => "reference",
            Self::Other => "other",
        }
    }

    /// Classe le nœud d'expression `node`.
    fn of(node: Node<'_>) -> Self {
        match node.kind() {
            "string" => Self::Str,
            "number" => Self::Number,
            "true" | "false" => Self::Bool,
            "nil" => Self::Nil,
            "table_constructor" => Self::Table,
            "function_definition" => Self::Function,
            "function_call" => Self::Call,
            "identifier" | "dot_index_expression" | "bracket_index_expression" | "global" => {
                Self::Reference
            }
            _ => Self::Other,
        }
    }
}

/// Affectation observée (`x = …`, `local x = …`, `t.x = …`).
#[derive(Debug, Clone)]
pub struct LuaAssignment {
    /// Cible de l'affectation, telle qu'écrite.
    pub name: String,
    /// Classe de la valeur affectée.
    pub value_kind: ValueKind,
    /// Valeur brute, tronquée pour rester affichable.
    pub raw_value: String,
    /// Vrai si la déclaration est `local`.
    pub is_local: bool,
    /// Ligne (base 1).
    pub line: u32,
}

/// Champ d'un constructeur de table.
#[derive(Debug, Clone)]
pub struct LuaTableField {
    /// Clé du champ ; `None` pour un champ positionnel.
    pub key: Option<String>,
    /// Classe de la valeur.
    pub value_kind: ValueKind,
    /// Valeur brute, tronquée.
    pub raw_value: String,
}

/// Table affectée à une variable nommée.
#[derive(Debug, Clone)]
pub struct LuaTable {
    /// Nom de la variable qui reçoit la table.
    pub name: String,
    /// Ligne du constructeur (base 1).
    pub line: u32,
    /// Champs de premier niveau.
    pub fields: Vec<LuaTableField>,
}

/// Résultat complet de l'analyse d'une source Lua.
#[derive(Debug, Clone, Default)]
pub struct LuaAnalysis {
    /// Chemin d'origine, quand l'analyse vient d'un fichier.
    pub path: Option<PathBuf>,
    /// Nombre de lignes de la source.
    pub line_count: u32,
    /// Fonctions déclarées, en ordre de source.
    pub functions: Vec<LuaFunction>,
    /// Sites d'appel, en ordre de source.
    pub calls: Vec<LuaCall>,
    /// Erreurs de syntaxe, en ordre de source.
    pub errors: Vec<LuaSyntaxError>,
    /// Affectations, en ordre de source.
    pub assignments: Vec<LuaAssignment>,
    /// Tables nommées, en ordre de source.
    pub tables: Vec<LuaTable>,
    /// Chaînes littérales retenues (dédupliquées, triées) — cf. [`is_interesting_string`].
    pub strings: Vec<String>,
    /// Chaînes passées à `CRC32(…)` (dédupliquées, triées).
    ///
    /// Le moteur adresse ses ressources de menu par le hash CRC32 de leur nom ; ces chaînes
    /// sont donc la clé de lecture des identifiants qu'on retrouve dans les données binaires.
    pub crc32_strings: Vec<String>,
}

impl LuaAnalysis {
    /// Vrai si la grammaire n'a signalé aucun nœud fautif.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }

    /// Nombre d'appels par cible (nom résolu), du plus fréquent au moins fréquent puis
    /// alphabétique — l'ordre est total, donc la sortie est reproductible.
    #[must_use]
    pub fn call_counts(&self) -> Vec<(String, usize)> {
        let mut counts: HashMap<&str, usize> = HashMap::new();
        for call in &self.calls {
            *counts.entry(call.name()).or_insert(0) += 1;
        }
        let mut out: Vec<(String, usize)> = counts
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect();
        out.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        out
    }

    /// Noms des fonctions déclarées, en ordre de source.
    #[must_use]
    pub fn function_names(&self) -> Vec<&str> {
        self.functions.iter().map(|f| f.name.as_str()).collect()
    }
}

/// Longueur maximale conservée pour une valeur brute : au-delà, une table de 400 champs
/// ferait des lignes de sortie illisibles pour aucune information de plus.
const RAW_VALUE_MAX: usize = 120;

/// Analyse une source Lua.
///
/// L'analyse est tolérante : une source syntaxiquement fautive rend quand même un
/// [`LuaAnalysis`] exploitable, avec les fautes dans [`LuaAnalysis::errors`]. Seule une
/// défaillance du runtime tree-sitter produit une erreur.
///
/// # Errors
/// [`StaticAnalysisError::Language`] si la grammaire est incompatible avec le runtime,
/// [`StaticAnalysisError::NoTree`] si tree-sitter ne rend pas d'arbre.
pub fn analyze(source: &str) -> Result<LuaAnalysis, StaticAnalysisError> {
    let mut parser = Parser::new();
    parser.set_language(&tree_sitter_lua::LANGUAGE.into())?;
    let tree = parser
        .parse(source, None)
        .ok_or(StaticAnalysisError::NoTree)?;

    let mut analysis = LuaAnalysis {
        line_count: u32::try_from(source.lines().count()).unwrap_or(u32::MAX),
        ..LuaAnalysis::default()
    };
    Walker::new(source).run(tree.root_node(), &mut analysis);
    Ok(analysis)
}

/// Analyse le fichier Lua `path`.
///
/// # Errors
/// [`StaticAnalysisError::Io`] si le fichier n'est pas lisible, plus les erreurs d'[`analyze`].
pub fn analyze_file(path: &Path) -> Result<LuaAnalysis, StaticAnalysisError> {
    // `from_utf8_lossy` : certains scripts décompilés portent des libellés japonais mal
    // ré-encodés ; les rejeter ferait perdre tout le fichier pour quelques octets.
    let bytes = fs::read(path).map_err(|source| StaticAnalysisError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let source = String::from_utf8_lossy(&bytes);
    let mut analysis = analyze(&source)?;
    analysis.path = Some(path.to_path_buf());
    Ok(analysis)
}

/// Liste récursivement les fichiers `.lua` sous `dir`, triés par chemin.
///
/// Les sous-répertoires illisibles sont ignorés : sur une arborescence de dump, une
/// permission manquante ne doit pas annuler l'analyse des milliers d'autres fichiers.
#[must_use]
pub fn collect_lua_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = fs::read_dir(&d) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else if p
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("lua"))
            {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

/// Analyse récursivement tous les `.lua` sous `dir`.
///
/// Chaque fichier rend son propre résultat : un fichier illisible n'interrompt pas le lot,
/// il est simplement absent de la liste.
///
/// # Errors
/// [`StaticAnalysisError::Language`] si la grammaire est incompatible avec le runtime.
pub fn analyze_dir(dir: &Path) -> Result<Vec<LuaAnalysis>, StaticAnalysisError> {
    let mut out = Vec::new();
    for path in collect_lua_files(dir) {
        match analyze_file(&path) {
            Ok(a) => out.push(a),
            Err(StaticAnalysisError::Io { .. }) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(out)
}

/// Vrai si la chaîne mérite d'être retenue : plus de 3 caractères et pas un simple nombre.
///
/// Ce filtre sert à écarter le bruit (`"x"`, `"0"`, `"12"`) d'un dump de plusieurs centaines
/// de milliers de littéraux, où seuls les identifiants de ressource ont de la valeur.
#[must_use]
pub fn is_interesting_string(s: &str) -> bool {
    s.chars().count() > 3 && !s.bytes().all(|b| b.is_ascii_digit())
}

// ─── Traversée ────────────────────────────────────────────────────────────────────────

/// Valeur propagée pour un identifiant.
#[derive(Debug, Clone)]
enum Binding {
    /// L'identifiant est un alias d'un autre nom (`L2_1 = CRC32`).
    Alias(String),
    /// L'identifiant tient une chaîne littérale (`L3_1 = "foo"`).
    Str(String),
}

/// Élément de la pile de travail : soit un nœud à visiter, soit une liaison à poser.
///
/// Les liaisons sont empilées **avant** les enfants du nœud d'affectation pour être
/// dépilées **après** eux : le membre droit doit être lu avec les alias d'avant.
enum Work<'t> {
    Visit(Node<'t>),
    Bind(String, Option<Binding>),
}

/// Nombre d'enfants **nommés**, en `u32`.
///
/// tree-sitter compte en `usize` mais indexe en `u32` : sans cette conversion explicite,
/// chaque boucle `0..count` réclamerait un `try_into` sur le site d'indexation.
fn named_count(node: Node<'_>) -> u32 {
    u32::try_from(node.named_child_count()).unwrap_or(u32::MAX)
}

/// Nombre d'enfants (nommés ou non), en `u32` — même raison que [`named_count`].
fn child_count(node: Node<'_>) -> u32 {
    u32::try_from(node.child_count()).unwrap_or(u32::MAX)
}

/// État de la traversée : source, environnement d'alias et chaînes accumulées.
struct Walker<'s> {
    source: &'s [u8],
    env: HashMap<String, Binding>,
    strings: Vec<String>,
    crc32_strings: Vec<String>,
}

impl<'s> Walker<'s> {
    fn new(source: &'s str) -> Self {
        Self {
            source: source.as_bytes(),
            env: HashMap::new(),
            strings: Vec::new(),
            crc32_strings: Vec::new(),
        }
    }

    /// Texte source d'un nœud.
    fn text(&self, node: Node<'_>) -> String {
        node.utf8_text(self.source).unwrap_or_default().to_string()
    }

    /// Texte source d'un nœud, tronqué à [`RAW_VALUE_MAX`] et aplati sur une ligne.
    fn short_text(&self, node: Node<'_>) -> String {
        let raw = self.text(node);
        let flat: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        if flat.chars().count() <= RAW_VALUE_MAX {
            return flat;
        }
        let cut: String = flat.chars().take(RAW_VALUE_MAX).collect();
        format!("{cut}…")
    }

    /// Contenu d'un littéral chaîne, quotes et délimiteurs longs retirés.
    fn string_value(&self, node: Node<'_>) -> String {
        // La grammaire isole le contenu dans `string_content` ; s'en servir évite de
        // réimplémenter le découpage des chaînes longues `[==[ … ]==]`.
        for i in 0..named_count(node) {
            if let Some(child) = node.named_child(i)
                && child.kind() == "string_content"
            {
                return self.text(child);
            }
        }
        // Chaîne vide : pas de `string_content`, seulement les délimiteurs.
        String::new()
    }

    /// Résout un nœud d'expression en la chaîne qu'il désigne, littérale ou par alias.
    fn as_string(&self, node: Node<'_>) -> Option<String> {
        match node.kind() {
            "string" => Some(self.string_value(node)),
            "identifier" => match self.env.get(&self.text(node)) {
                Some(Binding::Str(s)) => Some(s.clone()),
                _ => None,
            },
            _ => None,
        }
    }

    /// Résout le nom réel d'une cible d'appel via les alias propagés.
    fn resolve_name(&self, raw: &str) -> Option<String> {
        match self.env.get(raw) {
            Some(Binding::Alias(name)) => Some(name.clone()),
            _ => None,
        }
    }

    /// Liaison à poser pour `name = value`, ou `None` si la valeur n'est pas propageable
    /// (l'ancienne liaison est alors retirée : garder un alias périmé produirait du faux).
    fn binding_of(&self, value: Node<'_>) -> Option<Binding> {
        match value.kind() {
            "string" => Some(Binding::Str(self.string_value(value))),
            "identifier" => {
                let raw = self.text(value);
                Some(
                    self.resolve_name(&raw)
                        .map_or(Binding::Alias(raw), Binding::Alias),
                )
            }
            "dot_index_expression" | "method_index_expression" => {
                Some(Binding::Alias(self.text(value)))
            }
            _ => None,
        }
    }

    /// Parcourt l'arbre en ordre de source et remplit `out`.
    fn run(mut self, root: Node<'s>, out: &mut LuaAnalysis) {
        let mut stack = vec![Work::Visit(root)];
        while let Some(item) = stack.pop() {
            let node = match item {
                Work::Bind(name, Some(b)) => {
                    self.env.insert(name, b);
                    continue;
                }
                Work::Bind(name, None) => {
                    self.env.remove(&name);
                    continue;
                }
                Work::Visit(n) => n,
            };

            self.record_errors(node, out);
            match node.kind() {
                "function_declaration" => self.record_function(node, out),
                "function_definition" => self.record_anonymous_function(node, out),
                "function_call" => self.record_call(node, out),
                "assignment_statement" => self.record_assignment(node, out, &mut stack),
                "string" => {
                    let v = self.string_value(node);
                    if is_interesting_string(&v) {
                        self.strings.push(v);
                    }
                }
                _ => {}
            }

            // Enfants en ordre inverse : la pile les ressort en ordre de source.
            for i in (0..child_count(node)).rev() {
                if let Some(child) = node.child(i) {
                    stack.push(Work::Visit(child));
                }
            }
        }

        self.strings.sort_unstable();
        self.strings.dedup();
        self.crc32_strings.sort_unstable();
        self.crc32_strings.dedup();
        out.strings = self.strings;
        out.crc32_strings = self.crc32_strings;
    }

    /// Enregistre `node` s'il est un nœud fautif de la grammaire.
    fn record_errors(&self, node: Node<'_>, out: &mut LuaAnalysis) {
        let kind = if node.is_missing() {
            SyntaxErrorKind::Missing
        } else if node.is_error() {
            SyntaxErrorKind::Unparsable
        } else {
            return;
        };
        let pos = node.start_position();
        let text = if kind == SyntaxErrorKind::Missing {
            node.kind().to_string()
        } else {
            self.short_text(node)
        };
        out.errors.push(LuaSyntaxError {
            kind,
            line: u32::try_from(pos.row).unwrap_or(u32::MAX).saturating_add(1),
            column: u32::try_from(pos.column)
                .unwrap_or(u32::MAX)
                .saturating_add(1),
            text,
        });
    }

    /// Paramètres formels déclarés par `node` (un `function_declaration`/`function_definition`).
    fn params_of(&self, node: Node<'_>) -> Vec<String> {
        let Some(params) = node.child_by_field_name("parameters") else {
            return Vec::new();
        };
        (0..named_count(params))
            .filter_map(|i| params.named_child(i))
            .map(|p| self.text(p))
            .collect()
    }

    /// Lignes (base 1) couvertes par `node`.
    fn line_span(node: Node<'_>) -> (u32, u32) {
        let start = u32::try_from(node.start_position().row).unwrap_or(u32::MAX);
        let end = u32::try_from(node.end_position().row).unwrap_or(u32::MAX);
        (start.saturating_add(1), end.saturating_add(1))
    }

    /// Enregistre `function f()`, `local function f()`, `function t.f()`, `function t:f()`.
    fn record_function(&self, node: Node<'_>, out: &mut LuaAnalysis) {
        let name_node = node.child_by_field_name("name");
        let kind = if name_node.is_some_and(|n| n.kind() == "method_index_expression") {
            FunctionKind::Method
        } else if node.child(0).is_some_and(|c| c.kind() == "local") {
            // La grammaire alias `local function` sur le même type de nœud : seul le jeton
            // de tête distingue les deux formes.
            FunctionKind::Local
        } else {
            FunctionKind::Global
        };
        let (start_line, end_line) = Self::line_span(node);
        out.functions.push(LuaFunction {
            name: name_node.map(|n| self.text(n)).unwrap_or_default(),
            kind,
            params: self.params_of(node),
            start_line,
            end_line,
        });
    }

    /// Enregistre une fonction anonyme, en lui rendant le nom de sa cible d'affectation
    /// quand il y en a une — sans quoi `t.cb = function() … end` serait illisible.
    fn record_anonymous_function(&self, node: Node<'_>, out: &mut LuaAnalysis) {
        let (start_line, end_line) = Self::line_span(node);
        out.functions.push(LuaFunction {
            name: self.assignment_target_of(node).unwrap_or_default(),
            kind: FunctionKind::Anonymous,
            params: self.params_of(node),
            start_line,
            end_line,
        });
    }

    /// Nom de la variable qui reçoit l'expression `node`, si `node` est le n-ième membre
    /// droit d'une affectation.
    fn assignment_target_of(&self, node: Node<'_>) -> Option<String> {
        let list = node.parent().filter(|p| p.kind() == "expression_list")?;
        let index = (0..named_count(list))
            .find(|&i| list.named_child(i).is_some_and(|c| c.id() == node.id()))?;
        let assignment = list
            .parent()
            .filter(|p| p.kind() == "assignment_statement")?;
        let vars = (0..named_count(assignment))
            .filter_map(|i| assignment.named_child(i))
            .find(|c| c.kind() == "variable_list")?;
        vars.named_child(index).map(|v| self.text(v))
    }

    /// Enregistre un site d'appel et, si la cible est `CRC32`, ses arguments chaîne.
    fn record_call(&mut self, node: Node<'_>, out: &mut LuaAnalysis) {
        let Some(target) = node.child_by_field_name("name") else {
            return;
        };
        let callee = self.text(target);
        let resolved = self.resolve_name(&callee);
        let args = node.child_by_field_name("arguments");
        let mut arg_count = 0usize;
        let mut string_args = Vec::new();
        if let Some(args) = args {
            arg_count = args.named_child_count();
            for i in 0..named_count(args) {
                if let Some(arg) = args.named_child(i)
                    && let Some(s) = self.as_string(arg)
                {
                    string_args.push(s);
                }
            }
        }

        // `CRC32` peut arriver nu, via un alias de registre, ou en champ (`upval.CRC32`) :
        // tester le nom effectif couvre les trois sans énumérer les formes.
        let effective = resolved.as_deref().unwrap_or(&callee);
        if effective.contains("CRC32") {
            self.crc32_strings.extend(string_args.iter().cloned());
        }

        let line = Self::line_span(node).0;
        out.calls.push(LuaCall {
            callee,
            resolved,
            arg_count,
            string_args,
            line,
        });
    }

    /// Enregistre les couples `variable = valeur` d'une affectation, les tables qu'ils
    /// portent, et programme les liaisons à poser après la traversée du membre droit.
    fn record_assignment<'t>(
        &self,
        node: Node<'t>,
        out: &mut LuaAnalysis,
        stack: &mut Vec<Work<'t>>,
    ) {
        let mut vars = None;
        let mut values = None;
        for i in 0..named_count(node) {
            let Some(child) = node.named_child(i) else {
                continue;
            };
            match child.kind() {
                "variable_list" => vars = Some(child),
                "expression_list" => values = Some(child),
                _ => {}
            }
        }
        let (Some(vars), Some(values)) = (vars, values) else {
            return;
        };
        // `local x = …` : la grammaire enveloppe l'affectation dans un `variable_declaration`.
        let is_local = node
            .parent()
            .is_some_and(|p| p.kind() == "variable_declaration");
        let line = Self::line_span(node).0;

        let pairs = named_count(vars).min(named_count(values));
        for i in 0..pairs {
            let (Some(var), Some(value)) = (vars.named_child(i), values.named_child(i)) else {
                continue;
            };
            let name = self.text(var);
            let value_kind = ValueKind::of(value);

            if value_kind == ValueKind::Table {
                out.tables.push(LuaTable {
                    name: name.clone(),
                    line,
                    fields: self.table_fields(value),
                });
            }
            out.assignments.push(LuaAssignment {
                name: name.clone(),
                value_kind,
                raw_value: self.short_text(value),
                is_local,
                line,
            });

            // Ne concerne que les cibles simples : `t.f = x` ne crée pas d'alias exploitable.
            if var.kind() == "identifier" {
                stack.push(Work::Bind(name, self.binding_of(value)));
            }
        }
    }

    /// Champs de premier niveau d'un constructeur de table.
    fn table_fields(&self, table: Node<'_>) -> Vec<LuaTableField> {
        let mut out = Vec::new();
        for i in 0..named_count(table) {
            let Some(field) = table.named_child(i) else {
                continue;
            };
            if field.kind() != "field" {
                continue;
            }
            let key = field.child_by_field_name("name").map(|n| self.text(n));
            let value = field
                .child_by_field_name("value")
                .or_else(|| field.named_child(0));
            let (value_kind, raw_value) = value.map_or((ValueKind::Other, String::new()), |v| {
                (ValueKind::of(v), self.short_text(v))
            });
            out.push(LuaTableField {
                key,
                value_kind,
                raw_value,
            });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une source valide livre ses fonctions, leur nature et leurs paramètres.
    #[test]
    fn extrait_les_fonctions_declarees() {
        let src = r#"
function OnSetupLayer(layerId)
  return layerId
end

local function helper(a, b, ...)
  return a + b
end

function Menu.open(self, id)
end

function Menu:close()
end

local cb = function(x) return x end
"#;
        let a = analyze(src).expect("analyse");
        assert!(a.is_valid(), "source valide : {:?}", a.errors);

        let noms = a.function_names();
        assert!(noms.contains(&"OnSetupLayer"), "{noms:?}");
        assert!(noms.contains(&"helper"), "{noms:?}");
        assert!(noms.contains(&"Menu.open"), "{noms:?}");
        assert!(noms.contains(&"Menu:close"), "{noms:?}");
        // La fonction anonyme hérite du nom de sa cible d'affectation.
        assert!(noms.contains(&"cb"), "{noms:?}");

        let f = |n: &str| a.functions.iter().find(|f| f.name == n).expect(n).clone();
        assert_eq!(f("OnSetupLayer").kind, FunctionKind::Global);
        assert_eq!(f("OnSetupLayer").params, vec!["layerId"]);
        assert_eq!(f("helper").kind, FunctionKind::Local);
        assert_eq!(f("helper").params, vec!["a", "b", "..."]);
        assert_eq!(f("Menu:close").kind, FunctionKind::Method);
        assert_eq!(f("cb").kind, FunctionKind::Anonymous);
        assert_eq!(f("OnSetupLayer").start_line, 2);
        assert_eq!(f("OnSetupLayer").end_line, 4);
    }

    /// Les appels sont relevés avec leur cible, leur arité et leurs arguments chaîne.
    #[test]
    fn extrait_les_appels() {
        let src = r#"
INCLUDE("LUA_PROG_BASE")
local h = CRC32("chara_filter_menu_tab_text_element")
SetObjectVisible(h, true)
INCLUDE("LUA_LISTVIEW_INC")
"#;
        let a = analyze(src).expect("analyse");
        assert!(a.is_valid(), "{:?}", a.errors);

        let noms: Vec<&str> = a.calls.iter().map(LuaCall::name).collect();
        assert_eq!(
            noms,
            vec!["INCLUDE", "CRC32", "SetObjectVisible", "INCLUDE"]
        );
        assert_eq!(a.calls[2].arg_count, 2);
        assert_eq!(a.calls[0].string_args, vec!["LUA_PROG_BASE"]);
        assert_eq!(a.crc32_strings, vec!["chara_filter_menu_tab_text_element"]);

        // Le comptage agrégé classe par fréquence décroissante.
        let counts = a.call_counts();
        assert_eq!(counts[0], ("INCLUDE".to_string(), 2));
    }

    /// La forme « machine à registres » du décompilateur est résolue jusqu'au nom réel.
    #[test]
    fn resout_les_alias_de_registres_du_decompilateur() {
        // Reproduit littéralement la sortie de décompilation des scripts du jeu.
        let src = r#"
local L0_1, L1_1, L2_1, L3_1
L0_1 = INCLUDE
L1_1 = "LUA_PROG_BASE"
L0_1(L1_1)
L2_1 = CRC32
L3_1 = "filter_symbol01"
L2_1 = L2_1(L3_1)
"#;
        let a = analyze(src).expect("analyse");
        assert!(a.is_valid(), "{:?}", a.errors);

        let noms: Vec<&str> = a.calls.iter().map(LuaCall::name).collect();
        assert_eq!(noms, vec!["INCLUDE", "CRC32"]);
        assert_eq!(a.calls[0].string_args, vec!["LUA_PROG_BASE"]);
        // La liaison ne doit être posée qu'après lecture du membre droit, sinon
        // `L2_1 = L2_1(L3_1)` perdrait l'alias `CRC32` avant d'avoir servi.
        assert_eq!(a.calls[1].callee, "L2_1");
        assert_eq!(a.calls[1].resolved.as_deref(), Some("CRC32"));
        assert_eq!(a.crc32_strings, vec!["filter_symbol01"]);
    }

    /// Une erreur de syntaxe est localisée, et le reste du fichier reste analysable.
    #[test]
    fn detecte_une_erreur_de_syntaxe() {
        let src = "function bon() return 1 end\nfunction casse(( ,, )\n";
        let a = analyze(src).expect("analyse");

        assert!(!a.is_valid(), "la source est fautive");
        let e = &a.errors[0];
        assert!(e.line >= 2, "l'erreur est en ligne 2 ou après : {e:?}");
        assert!(a.errors.iter().any(|e| matches!(
            e.kind,
            SyntaxErrorKind::Unparsable | SyntaxErrorKind::Missing
        )));
        // Extraction partielle : la fonction saine avant l'erreur est quand même vue.
        assert!(
            a.function_names().contains(&"bon"),
            "{:?}",
            a.function_names()
        );
    }

    /// Un `end` manquant produit un nœud `MISSING`, pas un `ERROR`.
    #[test]
    fn detecte_un_jeton_manquant() {
        let a = analyze("function f()\n  return 1\n").expect("analyse");
        assert!(!a.is_valid());
        assert!(
            a.errors.iter().any(|e| e.kind == SyntaxErrorKind::Missing),
            "{:?}",
            a.errors
        );
    }

    /// Affectations et tables sont relevées avec leur classe de valeur.
    #[test]
    fn extrait_affectations_et_tables() {
        let src = r#"
local conf = { tabIconType = 0, tabTextName = "abc", 42 }
GLOBAL_FLAG = true
"#;
        let a = analyze(src).expect("analyse");
        assert!(a.is_valid(), "{:?}", a.errors);

        let conf = a
            .tables
            .iter()
            .find(|t| t.name == "conf")
            .expect("table conf");
        assert_eq!(conf.fields.len(), 3);
        assert_eq!(conf.fields[0].key.as_deref(), Some("tabIconType"));
        assert_eq!(conf.fields[1].value_kind, ValueKind::Str);
        assert_eq!(conf.fields[2].key, None, "champ positionnel");

        let g = a
            .assignments
            .iter()
            .find(|x| x.name == "GLOBAL_FLAG")
            .expect("GLOBAL_FLAG");
        assert_eq!(g.value_kind, ValueKind::Bool);
        assert!(!g.is_local);
        assert!(a.assignments.iter().any(|x| x.name == "conf" && x.is_local));
    }

    /// Le filtre de chaînes écarte le bruit court ou purement numérique.
    #[test]
    fn filtre_les_chaines_sans_interet() {
        assert!(is_interesting_string("filter_symbol01"));
        assert!(!is_interesting_string("ab"));
        assert!(!is_interesting_string("12345"));

        let a = analyze(r#"a = "xy" b = "1234" c = "menu_icon" "#).expect("analyse");
        assert_eq!(a.strings, vec!["menu_icon"]);
    }

    /// Bout-en-bout sur les vrais scripts décompilés du jeu, si le dump local est présent.
    #[test]
    fn analyse_les_scripts_decompiles_du_jeu() {
        let dir = Path::new("../../../data/lua_scripts/decompiled");
        if !dir.is_dir() {
            eprintln!(
                "skip analyse_les_scripts_decompiles_du_jeu : {} absent",
                dir.display()
            );
            return;
        }
        let fichiers = collect_lua_files(dir);
        if fichiers.is_empty() {
            eprintln!("skip : aucun .lua sous {}", dir.display());
            return;
        }
        let mut total_fonctions = 0usize;
        let mut total_appels = 0usize;
        let mut total_crc32 = 0usize;
        let mut fautifs = 0usize;
        for p in fichiers.iter().take(40) {
            let a = analyze_file(p).expect("analyse fichier");
            total_fonctions += a.functions.len();
            total_appels += a.calls.len();
            total_crc32 += a.crc32_strings.len();
            if !a.is_valid() {
                fautifs += 1;
            }
        }
        eprintln!(
            "scripts={} fonctions={total_fonctions} appels={total_appels} \
             crc32={total_crc32} fautifs={fautifs}",
            fichiers.len().min(40)
        );
        assert!(
            total_appels > 0,
            "les scripts du jeu doivent contenir des appels"
        );
        assert!(
            total_crc32 > 0,
            "la résolution d'alias doit retrouver des chaînes CRC32 dans les scripts décompilés"
        );
    }
}
