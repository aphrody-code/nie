//! Generic, read-only SQLite entity catalogue and query execution.
//!
//! This module owns the schema discovery, validated filtering, SQL construction, faceting,
//! pagination, and row decoding shared by CLI, MCP, desktop, and HTTP adapters.

use std::collections::BTreeMap;

use rusqlite::Connection;
use rusqlite::types::Value as ValeurSql;
use serde::Serialize;
use serde_json::{Map as MapJson, Value as ValeurJson};

const PER_PAGE_DEFAULT: u32 = 50;
const PER_PAGE_MAX: u32 = 200;

/// Domain errors produced by generic entity queries.
#[derive(Debug, thiserror::Error)]
pub enum EntitiesError {
    /// A requested table or row does not exist.
    #[error("{0}")]
    NotFound(String),
    /// Query parameters cannot be honored.
    #[error("{0}")]
    InvalidRequest(String),
    /// SQLite failed while reading the catalogue.
    #[error("SQLite entity read failed")]
    Sqlite(#[source] rusqlite::Error),
}

impl From<rusqlite::Error> for EntitiesError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

/// Bounded pagination independent of any transport.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pagination {
    pub page: u32,
    pub per_page: u32,
}

impl Pagination {
    #[must_use]
    pub fn borner(page: Option<u32>, per_page: Option<u32>) -> Self {
        Self {
            page: page.unwrap_or(1).max(1),
            per_page: per_page.unwrap_or(PER_PAGE_DEFAULT).clamp(1, PER_PAGE_MAX),
        }
    }

    #[must_use]
    pub fn offset(self) -> usize {
        (self.page as usize - 1).saturating_mul(self.per_page as usize)
    }
}

/// A transport-neutral page of results.
#[derive(Debug, Clone, Serialize)]
pub struct Page<T> {
    pub elements: Vec<T>,
    pub page: u32,
    pub per_page: u32,
    pub total: usize,
    pub pages: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub q: Option<String>,
}

impl<T> Page<T> {
    #[must_use]
    pub fn nouvelle(elements: Vec<T>, pagination: Pagination, total: usize) -> Self {
        let per_page = pagination.per_page as usize;
        Self {
            elements,
            page: pagination.page,
            per_page: pagination.per_page,
            total,
            pages: total.div_ceil(per_page.max(1)),
            q: None,
        }
    }
}

/// Préfixe des tables **non servies**.
///
/// `_meta` porte l'horodatage du miroir et la chaîne de connexion d'amont : de la plomberie,
/// exactement ce qu'une façade ne montre pas. L'exclure fait tomber le catalogue de 220 à 219
/// tables — le compte que `_meta` s'annonce lui-même (`tables_count = 219`).
pub const PREFIXE_INTERNE: char = '_';

/// Noms de paramètres réservés par la route : tout le reste est lu comme un filtre d'égalité
/// sur une colonne.
///
/// `par_page` et `per_page` sont acceptés tous les deux — le premier parce que c'est le nom
/// français de la route, le second parce que c'est celui du reste de l'API
/// (`per_page` is the shared API spelling) et qu'un client qui l'emploie ne doit pas se retrouver avec
/// un `400` sur une « colonne inconnue `per_page` ».
pub const PARAMS_RESERVES: [&str; 8] = [
    "page", "par_page", "per_page", "tri", "ordre", "q", "format", "facets",
];

/// Combien de colonnes une seule demande peut faceter.
///
/// Chaque facette est un `GROUP BY` de plus sur la même table : douze est déjà généreux pour
/// une barre de filtres, et au-delà c'est un client qui demande le schéma entier en croyant
/// demander des filtres. **Refusé**, pas tronqué — une demande tronquée en silence rend des
/// comptes justes sur des colonnes que le client croyait avoir demandées en plus.
pub const FACETS_MAX: usize = 12;

/// Combien de valeurs distinctes une facette republie.
///
/// Au-delà, la liste est **coupée et le dit** (`truncated`), avec le nombre de valeurs
/// distinctes réellement présentes (`distinct`) : une facette de 199 équipes se dessine en
/// « les 60 plus fournies + 139 autres », jamais en une liste qui ment sur sa longueur.
pub const FACET_VALEURS_MAX: usize = 60;

/// Les formats de sortie servis par `/api/v1/entites/{table}`.
///
/// Volontairement courte : `json` (le défaut) et `csv`. Un format inconnu est un `400` — le
/// rendre en JSON « par défaut » ferait télécharger un fichier au mauvais format sans un mot.
pub const FORMATS: [&str; 2] = ["json", "csv"];

/// Suffixe de borne basse — `?power_max__min=400`.
pub const SUFFIXE_MIN: &str = "__min";

/// Suffixe de choix multiple — `?element__in=Feu,Vent`.
///
/// La facette dessine des valeurs cliquables et son compte exclut déjà le filtre de sa propre
/// colonne, précisément pour qu'on puisse en **ajouter** une seconde. Sans ce suffixe,
/// l'interface promettrait un geste que l'API ne sait pas prendre — une affordance se vérifie
/// avant d'être dessinée.
///
/// **La virgule sépare, donc une valeur qui en contient s'écrit en égalité simple**
/// (`?colonne=a,b` cherche la valeur littérale `a,b`). Mesuré sur les colonnes facetables des
/// 6 166 personnages : **0** valeur porte une virgule.
pub const SUFFIXE_IN: &str = "__in";

/// Combien de valeurs un `__in` accepte.
///
/// Au-delà, ce n'est plus un filtre mais une liste d'identifiants : **refusé**, pas tronqué —
/// une liste coupée en silence rendrait des lignes justes pour une question qui n'a pas été
/// posée.
pub const IN_VALEURS_MAX: usize = 60;

/// Suffixe de borne haute — `?power_max__max=880`.
pub const SUFFIXE_MAX: &str = "__max";

/// Valeur-jeton demandant les lignes où la colonne est renseignée.
///
/// Mesuré avant d'être choisi : **0 des 165 249 lignes** des 219 tables ne porte cette chaîne,
/// donc aucun filtre d'égalité légitime n'est détourné par elle.
pub const JETON_PRESENT: &str = "__present__";

/// Valeur-jeton demandant les lignes où la colonne est nulle ou vide.
pub const JETON_ABSENT: &str = "__absent__";

/// Longueur maximale d'un identifiant SQL accepté depuis le client.
///
/// Ce n'est pas la garde de sécurité — celle-ci est la recherche dans le catalogue — mais elle
/// évite de promener une chaîne d'un mégaoctet jusqu'à la comparaison.
pub const NOM_MAX: usize = 64;

/// Une colonne, telle que `PRAGMA table_info` la décrit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Colonne {
    /// Nom de la colonne, **verbatim depuis la base**.
    pub nom: String,
    /// Type déclaré (`TEXT`, `INTEGER`, `REAL`). Vide quand la colonne n'en déclare aucun.
    pub type_sql: String,
    /// `true` quand l'affinité de la colonne est textuelle : c'est l'ensemble sur lequel `q`
    /// cherche.
    pub texte: bool,
}

/// Nom public du gisement du miroir `inagle_*`.
pub const GISEMENT_EXTRAIT: &str = "extrait";

/// Nom public du gisement des épisodes de la série.
pub const GISEMENT_ANIME: &str = "anime";

/// Une table servable, avec son schéma mesuré.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TableServie {
    /// Gisement d'où elle vient — `extrait` (le miroir) ou `anime` (la série).
    ///
    /// Publié, parce que sans lui la route ferait passer deux corpus pour un seul. Ils n'ont
    /// **aucune clé commune** (CLAUDE.md § *Les quatre gisements*) : les servir par la même
    /// route générique n'est pas les joindre, et un client qui les croirait joignables se
    /// tromperait sans que rien ne l'en avertisse.
    pub gisement: &'static str,
    /// Nom de la table.
    pub nom: String,
    /// Colonne qui identifie une ligne, telle que [`cle_primaire`] la choisit.
    pub cle: String,
    /// `true` quand la clé est le `rowid` implicite de SQLite plutôt qu'une vraie colonne.
    pub cle_implicite: bool,
    /// Colonnes, dans l'ordre de la table.
    pub colonnes: Vec<Colonne>,
}

impl TableServie {
    /// Retrouve une colonne par son nom, sans casse.
    #[must_use]
    pub fn colonne(&self, nom: &str) -> Option<&Colonne> {
        self.colonnes
            .iter()
            .find(|c| c.nom.eq_ignore_ascii_case(nom))
    }

    /// Les colonnes sur lesquelles `q` peut chercher.
    #[must_use]
    pub fn colonnes_texte(&self) -> Vec<&Colonne> {
        self.colonnes.iter().filter(|c| c.texte).collect()
    }

    /// L'expression SQL qui rend la clé dans un `SELECT` — `"id"` ou `"rowid"`.
    #[must_use]
    pub fn cle_sql(&self) -> String {
        format!("\"{}\"", self.cle)
    }
}

/// Une table du catalogue, avec son compte de lignes.
#[derive(Debug, Clone, Serialize)]
pub struct TableComptee {
    /// Le schéma mesuré.
    #[serde(flatten)]
    pub table: TableServie,
    /// Nombre de lignes, compté à la demande.
    pub lignes: usize,
}

/// Le catalogue rendu par `GET /api/v1/entites`.
#[derive(Debug, Serialize)]
pub struct CatalogueEntites {
    /// La page de tables.
    #[serde(flatten)]
    pub page: Page<TableComptee>,
    /// Nombre de lignes de **toutes** les tables servies, filtre `q` compris.
    ///
    /// Il n'est pas le total de la page : c'est la seule information que la pagination ne porte
    /// pas déjà, et c'est pour cela qu'elle est ici plutôt qu'un compte de tables répété.
    pub lignes_totales: usize,
    /// La route qui rend les lignes d'une table.
    pub route_lignes: &'static str,
    /// La route qui rend une ligne.
    pub route_ligne: &'static str,
}

/// Le sens de tri demandé.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ordre {
    /// Croissant — le défaut.
    Croissant,
    /// Décroissant.
    Decroissant,
}

impl Ordre {
    /// Le mot-clé SQL correspondant. Il est **constant** : aucune chaîne du client n'entre là.
    #[must_use]
    pub fn sql(self) -> &'static str {
        match self {
            Self::Croissant => "ASC",
            Self::Decroissant => "DESC",
        }
    }

    /// Le jeton public, celui que la réponse republie.
    #[must_use]
    pub fn jeton(self) -> &'static str {
        match self {
            Self::Croissant => "asc",
            Self::Decroissant => "desc",
        }
    }
}

/// Ce que la route a réellement appliqué, republié dans la réponse.
#[derive(Debug, Clone, Serialize)]
pub struct FiltresAppliques {
    /// Motif de recherche retenu, `null` si aucun.
    pub q: Option<String>,
    /// Colonne de tri effective.
    pub tri: String,
    /// Sens de tri effectif.
    pub ordre: &'static str,
    /// Filtres d'égalité retenus, colonne → valeur.
    pub egalites: BTreeMap<String, String>,
    /// Choix multiples retenus, `colonne__in` → les valeurs acceptées.
    pub listes: BTreeMap<String, Vec<String>>,
    /// Bornes retenues, `colonne__min` / `colonne__max` → valeur numérique.
    pub bornes: BTreeMap<String, f64>,
    /// Tests de présence retenus, colonne → `"present"` ou `"absent"`.
    pub presences: BTreeMap<String, &'static str>,
}

/// Une demande analysée et validée contre le schéma d'une table.
#[derive(Debug, Clone)]
pub struct Demande {
    /// Bornes de pagination.
    pub pagination: Pagination,
    /// Motif de recherche, déjà nettoyé.
    pub q: Option<String>,
    /// Colonne de tri — **un nom du catalogue**, jamais celui envoyé par le client.
    pub tri: String,
    /// Sens de tri.
    pub ordre: Ordre,
    /// Égalités demandées, colonne du catalogue → valeur brute (qui sera liée).
    pub egalites: Vec<(String, String)>,
    /// Choix multiples : colonne du catalogue → les valeurs acceptées (un `IN`).
    pub listes: Vec<(String, Vec<String>)>,
    /// Bornes demandées : colonne du catalogue, sens, valeur.
    pub bornes: Vec<(String, Borne, f64)>,
    /// Présences demandées : colonne du catalogue, et si l'on veut ce qui est renseigné.
    pub presences: Vec<(String, bool)>,
    /// Colonnes à faceter — des noms du catalogue, jamais ceux envoyés par le client.
    pub facets: Vec<String>,
}

/// Une valeur d'une facette, et combien de lignes la portent.
#[derive(Debug, Clone, Serialize)]
pub struct FacetValeur {
    /// La valeur, telle qu'elle est stockée. `null` quand la colonne est vide ou nulle.
    pub value: Option<String>,
    /// Combien de lignes la portent, **sous les autres filtres en cours**.
    pub count: i64,
}

/// Les valeurs d'une colonne, comptées — de quoi dessiner une barre de filtres.
///
/// ## Ce que c'est, et ce que ce n'est pas
///
/// C'est le seul moyen de dessiner un filtre honnête : sans les valeurs et leurs comptes, une
/// interface ne peut proposer qu'un champ de texte libre, où l'utilisateur devine. Avec eux,
/// elle montre `feu 1 203`, et un choix qui rendrait zéro ligne **ne s'affiche pas**.
///
/// ## Le compte est calculé sans le filtre de SA propre colonne
///
/// C'est la seule définition qui rend une facette multi-sélectionnable utilisable. Avec
/// `?element=fire`, la facette `element` calculée sous tous les filtres rendrait une seule
/// valeur — `fire`, et son compte — et l'interface ne pourrait plus proposer « ajouter
/// `wind` ». Les autres filtres (`q`, bornes, présences, et les égalités des **autres**
/// colonnes) s'appliquent bien : c'est ce qui fait que les comptes correspondent à l'écran.
#[derive(Debug, Clone, Serialize)]
pub struct Facet {
    /// La colonne facetée.
    pub column: String,
    /// Combien de valeurs distinctes elle porte sous les filtres en cours.
    pub distinct: usize,
    /// Vrai quand la liste a été coupée à [`FACET_VALEURS_MAX`].
    pub truncated: bool,
    /// Les valeurs, les plus fournies d'abord.
    pub values: Vec<FacetValeur>,
}

/// Le sens d'une borne. Deux variantes closes, jamais une chaîne du client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Borne {
    /// `>=` — le suffixe `__min`.
    Minimum,
    /// `<=` — le suffixe `__max`.
    Maximum,
}

impl Borne {
    /// L'opérateur SQL. **Constant** : aucune chaîne du client n'entre là.
    #[must_use]
    pub fn sql(self) -> &'static str {
        match self {
            Self::Minimum => ">=",
            Self::Maximum => "<=",
        }
    }

    /// Le suffixe public, celui que la réponse republie.
    #[must_use]
    pub fn suffixe(self) -> &'static str {
        match self {
            Self::Minimum => SUFFIXE_MIN,
            Self::Maximum => SUFFIXE_MAX,
        }
    }
}

impl Demande {
    /// Ce qui a été appliqué, sous forme sérialisable.
    #[must_use]
    pub fn appliques(&self) -> FiltresAppliques {
        FiltresAppliques {
            q: self.q.clone(),
            tri: self.tri.clone(),
            ordre: self.ordre.jeton(),
            egalites: self.egalites.iter().cloned().collect(),
            listes: self
                .listes
                .iter()
                .map(|(c, v)| (format!("{c}{SUFFIXE_IN}"), v.clone()))
                .collect(),
            bornes: self
                .bornes
                .iter()
                .map(|(c, b, v)| (format!("{c}{}", b.suffixe()), *v))
                .collect(),
            presences: self
                .presences
                .iter()
                .map(|(c, present)| (c.clone(), if *present { "present" } else { "absent" }))
                .collect(),
        }
    }
}

/// Une clause `WHERE` construite, avec ses paramètres liés.
#[derive(Debug, Clone, Default)]
struct Clause {
    /// Le texte SQL, préfixé de ` WHERE ` quand il n'est pas vide.
    pub sql: String,
    /// Les valeurs, dans l'ordre des `?`.
    pub params: Vec<ValeurSql>,
}

/// Une page de lignes, avec la table, sa clé et ce qui a été appliqué.
#[derive(Debug, Serialize)]
pub struct PageLignes {
    /// La page elle-même.
    #[serde(flatten)]
    pub page: Page<MapJson<String, ValeurJson>>,
    /// Gisement d'où la table vient.
    pub gisement: &'static str,
    /// Nom de la table lue.
    pub table: String,
    /// Colonne qui identifie une ligne — celle que `/api/v1/entites/{table}/{id}` attend.
    pub cle: String,
    /// Ce que la route a appliqué.
    pub filtres: FiltresAppliques,
    /// Les facettes demandées, comptées sous les filtres en cours. Absent quand `?facets` ne
    /// l'est pas — une clé toujours présente et toujours vide ferait croire à une capacité
    /// absente.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub facets: Vec<Facet>,
}

/// Une ligne unique.
#[derive(Debug, Serialize)]
pub struct LigneUnique {
    /// Gisement d'où la table vient.
    pub gisement: &'static str,
    /// Nom de la table.
    pub table: String,
    /// Colonne de clé.
    pub cle: String,
    /// Valeur de clé telle que demandée.
    pub id: String,
    /// La ligne, colonne → valeur.
    pub ligne: MapJson<String, ValeurJson>,
}

// --------------------------------------------------------------------------------------------
// Mesure du schéma
// --------------------------------------------------------------------------------------------

/// Dit si une chaîne peut être un identifiant SQL de ce miroir.
///
/// Garde de forme, posée **avant** la recherche dans le catalogue : elle ne remplace pas cette
/// recherche (c'est elle, la sécurité), elle évite juste de la faire sur une chaîne absurde.
#[must_use]
pub fn nom_sql_valide(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= NOM_MAX
        && s.chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Dit si un type déclaré porte une affinité textuelle, selon la règle de SQLite (le type
/// contient `CHAR`, `CLOB` ou `TEXT`).
///
/// Un type absent donne une affinité `BLOB`, pas `TEXT` : chercher dedans avec `LIKE` reviendrait
/// à annoncer une recherche qui ne trouve rien.
#[must_use]
pub fn colonne_texte(type_sql: &str) -> bool {
    let t = type_sql.to_ascii_uppercase();
    t.contains("CHAR") || t.contains("CLOB") || t.contains("TEXT")
}

/// Choisit la colonne qui identifie une ligne.
///
/// Dans l'ordre : la clé primaire quand elle tient en **une** colonne, sinon une colonne nommée
/// `id`, sinon le `rowid` implicite. Mesuré sur ce miroir le 2026-09-06 : 1 table déclare une
/// clé primaire, 201 portent un `id`, 0 est `WITHOUT ROWID` — les 18 restantes retombent donc
/// sur `rowid`, qui existe toujours.
///
/// Rend `(nom, implicite)`.
#[must_use]
pub fn cle_primaire(colonnes: &[(String, String, i32)]) -> (String, bool) {
    let pk: Vec<&(String, String, i32)> = colonnes.iter().filter(|(_, _, pk)| *pk > 0).collect();
    if pk.len() == 1 {
        return (pk[0].0.clone(), false);
    }
    // Une colonne réellement nommée `rowid` masque le rowid implicite : c'est elle la clé, et
    // `SELECT rowid, *` la dupliquerait.
    for cible in ["rowid", "id"] {
        if let Some((nom, _, _)) = colonnes
            .iter()
            .find(|(n, _, _)| n.eq_ignore_ascii_case(cible))
        {
            return (nom.clone(), false);
        }
    }
    ("rowid".to_owned(), true)
}

/// Mesure le catalogue des tables servables sur la connexion.
///
/// Le schéma est **relu à chaque requête** : le miroir est un lien symbolique rebasculé chaque
/// nuit, et un catalogue mémorisé au démarrage décrirait tôt ou tard une autre base. Le coût
/// est celui de `sqlite_master` plus un `PRAGMA table_info` par table — aucun `count(*)`.
///
/// # Errors
///
/// Toute erreur SQLite, traduite en `500` sans laisser fuiter le SQL.
pub fn schema(c: &Connection) -> Result<Vec<TableServie>, EntitiesError> {
    schema_de(c, GISEMENT_EXTRAIT)
}

/// Le schéma d'une connexion, étiqueté par le gisement d'où elle vient.
///
/// # Errors
///
/// Toute erreur SQLite.
pub fn schema_de(
    c: &Connection,
    gisement: &'static str,
) -> Result<Vec<TableServie>, EntitiesError> {
    let mut stmt = c.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' \
         AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let noms: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let mut tables = Vec::with_capacity(noms.len());
    for nom in noms {
        if nom.starts_with(PREFIXE_INTERNE) || !nom_sql_valide(&nom) {
            continue;
        }
        // `PRAGMA table_info` ne se paramètre pas ; le nom vient de `sqlite_master`, donc de la
        // base elle-même, et il vient de repasser la garde de forme.
        let mut p = c.prepare(&format!("PRAGMA table_info(\"{nom}\")"))?;
        let brutes: Vec<(String, String, i32)> = p
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, i32>(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        if brutes.is_empty() || brutes.iter().any(|(n, _, _)| !nom_sql_valide(n)) {
            continue;
        }
        let (cle, cle_implicite) = cle_primaire(&brutes);
        tables.push(TableServie {
            gisement,
            nom,
            cle,
            cle_implicite,
            colonnes: brutes
                .into_iter()
                .map(|(nom, type_sql, _)| Colonne {
                    texte: colonne_texte(&type_sql),
                    nom,
                    type_sql,
                })
                .collect(),
        });
    }
    Ok(tables)
}

/// Retrouve une table dans le catalogue, ou dit en `404` qu'elle n'y est pas.
///
/// **C'est ici que se joue la sûreté** : la valeur rendue est une référence dans le catalogue
/// mesuré ; le nom du client, lui, ne sert qu'à comparer et n'est jamais réécrit dans du SQL.
///
/// # Errors
///
/// `Introuvable` quand aucune table servie ne porte ce nom.
pub fn trouver<'a>(
    catalogue: &'a [TableServie],
    demande: &str,
) -> Result<&'a TableServie, EntitiesError> {
    if nom_sql_valide(demande)
        && let Some(t) = catalogue
            .iter()
            .find(|t| t.nom.eq_ignore_ascii_case(demande))
    {
        return Ok(t);
    }
    Err(EntitiesError::NotFound(format!(
        "aucune table servie ne se nomme `{demande}` ; les {} tables servies sont sur \
         /api/v1/entites",
        catalogue.len()
    )))
}

// --------------------------------------------------------------------------------------------
// Analyse de la demande
// --------------------------------------------------------------------------------------------

/// Analyse la query string contre le schéma d'une table.
///
/// # Errors
///
/// `Demande` (400) pour un `page`/`par_page` non numérique, un `tri` ou un filtre visant une
/// colonne inconnue, un `ordre` autre que `asc`/`desc`, une valeur de filtre vide, ou un `q`
/// demandé sur une table sans colonne texte.
pub fn analyser(
    table: &TableServie,
    brut: &BTreeMap<String, String>,
) -> Result<Demande, EntitiesError> {
    let entier = |cle: &str| -> Result<Option<u32>, EntitiesError> {
        match brut.get(cle) {
            None => Ok(None),
            Some(v) => v.trim().parse::<u32>().map(Some).map_err(|_| {
                EntitiesError::InvalidRequest(format!("`{cle}` doit etre un entier, recu `{v}`"))
            }),
        }
    };
    let page = entier("page")?;
    let par_page = match entier("par_page")? {
        Some(n) => Some(n),
        None => entier("per_page")?,
    };
    let pagination = Pagination::borner(page, par_page);

    let q = match brut.get("q").map(|v| v.trim()).filter(|v| !v.is_empty()) {
        None => None,
        Some(m) => {
            if table.colonnes_texte().is_empty() {
                return Err(EntitiesError::InvalidRequest(format!(
                    "`{}` n'a aucune colonne texte : `q` n'y chercherait nulle part",
                    table.nom
                )));
            }
            Some(m.to_owned())
        }
    };

    let tri = match brut.get("tri").map(|v| v.trim()).filter(|v| !v.is_empty()) {
        None => table.cle.clone(),
        Some(demande) => {
            let c = table.colonne(demande).ok_or_else(|| {
                EntitiesError::InvalidRequest(format!(
                    "`tri={demande}` : `{}` n'a pas cette colonne ; son schema est sur \
                     /api/v1/entites",
                    table.nom
                ))
            })?;
            c.nom.clone()
        }
    };

    let ordre = match brut
        .get("ordre")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => Ordre::Croissant,
        Some(o) if o.eq_ignore_ascii_case("asc") => Ordre::Croissant,
        Some(o) if o.eq_ignore_ascii_case("desc") => Ordre::Decroissant,
        Some(o) => {
            return Err(EntitiesError::InvalidRequest(format!(
                "`ordre={o}` : seuls `asc` et `desc` sont acceptes"
            )));
        }
    };

    // Les facettes se declarent en UNE liste, pas en un parametre par colonne : un parametre
    // par colonne serait indistinguable d'une egalite (`?element=` est deja refuse comme
    // « valeur de filtre vide »), et le client ne saurait plus ce qu'il demande.
    let mut facets: Vec<String> = Vec::new();
    if let Some(liste) = brut
        .get("facets")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        for demande in liste.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let colonne = table.colonne(demande).ok_or_else(|| {
                EntitiesError::InvalidRequest(format!(
                    "`facets={demande}` : `{}` n'a pas cette colonne ; son schema est sur \
                     /api/v1/entites",
                    table.nom
                ))
            })?;
            if !facets.contains(&colonne.nom) {
                facets.push(colonne.nom.clone());
            }
        }
        if facets.len() > FACETS_MAX {
            return Err(EntitiesError::InvalidRequest(format!(
                "`facets` : {} colonnes demandees, {FACETS_MAX} au maximum — au-dela c'est le \
                 schema qui est demande, pas des filtres",
                facets.len()
            )));
        }
    }

    let mut egalites = Vec::new();
    let mut listes: Vec<(String, Vec<String>)> = Vec::new();
    let mut bornes = Vec::new();
    let mut presences = Vec::new();
    for (cle, valeur) in brut {
        if PARAMS_RESERVES.contains(&cle.as_str()) {
            continue;
        }

        // Le choix multiple se reconnait a son suffixe, comme les bornes. Il est traite AVANT
        // elles : `__in` et `__min` ne se recouvrent pas, mais l'ordre de lecture doit dire ce
        // que fait le code.
        if let Some(base) = cle.strip_suffix(SUFFIXE_IN) {
            let colonne = table.colonne(base).ok_or_else(|| {
                EntitiesError::InvalidRequest(format!(
                    "`{cle}` : `{}` n'a pas de colonne `{base}` ; son schema est sur \
                     /api/v1/entites",
                    table.nom
                ))
            })?;
            let mut valeurs: Vec<String> = Vec::new();
            for v in valeur.split(',').map(str::trim).filter(|v| !v.is_empty()) {
                if !valeurs.iter().any(|d| d == v) {
                    valeurs.push(v.to_owned());
                }
            }
            if valeurs.is_empty() {
                return Err(EntitiesError::InvalidRequest(format!(
                    "`{cle}={valeur}` : un choix multiple vide ne veut rien dire — retirez le \
                     parametre pour ne pas filtrer"
                )));
            }
            if valeurs.len() > IN_VALEURS_MAX {
                return Err(EntitiesError::InvalidRequest(format!(
                    "`{cle}` : {} valeurs, {IN_VALEURS_MAX} au maximum — au-dela c'est une \
                     liste d'identifiants, pas un filtre",
                    valeurs.len()
                )));
            }
            listes.push((colonne.nom.clone(), valeurs));
            continue;
        }

        // Une borne se reconnait au SUFFIXE du parametre, pas a sa valeur : `power_max__min`
        // vise la colonne `power_max`. Le suffixe est retire avant de chercher la colonne, sans
        // quoi la recherche echouerait sur un nom qui n'existe pas.
        if let Some((base, sens)) = cle
            .strip_suffix(SUFFIXE_MIN)
            .map(|b| (b, Borne::Minimum))
            .or_else(|| cle.strip_suffix(SUFFIXE_MAX).map(|b| (b, Borne::Maximum)))
        {
            let colonne = table.colonne(base).ok_or_else(|| {
                EntitiesError::InvalidRequest(format!(
                    "`{cle}` : `{}` n'a pas de colonne `{base}` ; son schema est sur \
                     /api/v1/entites",
                    table.nom
                ))
            })?;
            // Refuser plutot qu'approximer : SQLite comparerait `'Mark' >= '400'` par ordre
            // lexicographique et rendrait une page de lignes plausibles — faux sans en avoir
            // l'air, ce qui est le pire des resultats.
            if colonne.texte {
                return Err(EntitiesError::InvalidRequest(format!(
                    "`{cle}` : `{base}` est une colonne texte ({}), et une fourchette sur du \
                     texte comparerait des mots par ordre alphabetique ; utilisez l'egalite",
                    colonne.type_sql
                )));
            }
            let n: f64 = valeur.trim().parse().map_err(|_| {
                EntitiesError::InvalidRequest(format!("`{cle}={valeur}` : une borne est un nombre"))
            })?;
            bornes.push((colonne.nom.clone(), sens, n));
            continue;
        }

        let colonne = table.colonne(cle).ok_or_else(|| {
            EntitiesError::InvalidRequest(format!(
                "`{cle}` n'est ni un parametre de cette route ni une colonne de `{}` ; son \
                 schema est sur /api/v1/entites",
                table.nom
            ))
        })?;
        if valeur.trim().is_empty() {
            return Err(EntitiesError::InvalidRequest(format!(
                "`{cle}=` : une valeur de filtre vide n'a pas de sens ici — retirez le \
                 parametre pour ne pas filtrer"
            )));
        }
        // La presence se reconnait a la VALEUR, parce qu'elle porte sur la colonne elle-meme et
        // non sur un contenu. Les deux jetons sont surs : 0 des 165 249 lignes ne les porte.
        match valeur.as_str() {
            JETON_PRESENT => presences.push((colonne.nom.clone(), true)),
            JETON_ABSENT => presences.push((colonne.nom.clone(), false)),
            _ => egalites.push((colonne.nom.clone(), valeur.clone())),
        }
    }
    egalites.sort_by(|a, b| a.0.cmp(&b.0));
    listes.sort_by(|a, b| a.0.cmp(&b.0));
    bornes.sort_by(|a, b| (&a.0, a.1.suffixe()).cmp(&(&b.0, b.1.suffixe())));
    presences.sort_by(|a, b| a.0.cmp(&b.0));

    Ok(Demande {
        pagination,
        q,
        tri,
        ordre,
        egalites,
        listes,
        bornes,
        presences,
        facets,
    })
}

/// Construit la clause `WHERE` d'une demande déjà validée.
///
/// Aucune valeur n'entre dans le texte : seuls des `?` y entrent, et les noms de colonnes
/// viennent de `table`, c'est-à-dire de la base.
#[must_use]
fn clause(table: &TableServie, d: &Demande) -> Clause {
    clause_sauf(table, d, None)
}

/// La même clause, en **retirant** l'égalité portant sur une colonne donnée.
///
/// C'est ce qui rend une facette multi-sélectionnable : le compte de `element` se calcule sous
/// tous les filtres SAUF le sien, sinon `?element=fire` ferait rendre à la facette une unique
/// valeur et l'interface ne pourrait plus proposer d'en ajouter une seconde. Seule l'**égalité**
/// est retirée — une borne ou une présence sur la même colonne reste appliquée, parce qu'elles
/// ne se cumulent pas avec un choix de valeur, elles le restreignent.
///
/// Aucune valeur n'entre dans le texte : seuls des `?` y entrent, et les noms de colonnes
/// viennent de `table`.
#[must_use]
fn clause_sauf(table: &TableServie, d: &Demande, sauf: Option<&str>) -> Clause {
    let mut morceaux: Vec<String> = Vec::new();
    let mut params: Vec<ValeurSql> = Vec::new();

    if let Some(m) = d.q.as_deref() {
        // Les jokers sont échappés : un `%` tapé par un humain est un pourcent, pas « tout ».
        let motif = format!(
            "%{}%",
            m.to_lowercase()
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let colonnes = table.colonnes_texte();
        let ors: Vec<String> = colonnes
            .iter()
            .map(|c| format!("lower(\"{}\") LIKE ? ESCAPE '\\'", c.nom))
            .collect();
        if !ors.is_empty() {
            morceaux.push(format!("({})", ors.join(" OR ")));
            for _ in 0..ors.len() {
                params.push(ValeurSql::Text(motif.clone()));
            }
        }
    }

    for (colonne, valeur) in &d.egalites {
        if sauf == Some(colonne.as_str()) {
            continue;
        }
        morceaux.push(format!("\"{colonne}\" = ?"));
        params.push(ValeurSql::Text(valeur.clone()));
    }

    for (colonne, valeurs) in &d.listes {
        if sauf == Some(colonne.as_str()) {
            continue;
        }
        // Autant de `?` que de valeurs : aucune n'entre dans le texte SQL. `valeurs` est non
        // vide et borne par `IN_VALEURS_MAX`, garanti par `analyser`.
        let trous = std::iter::repeat_n("?", valeurs.len())
            .collect::<Vec<_>>()
            .join(", ");
        morceaux.push(format!("\"{colonne}\" IN ({trous})"));
        for v in valeurs {
            params.push(ValeurSql::Text(v.clone()));
        }
    }

    for (colonne, sens, valeur) in &d.bornes {
        // `CAST(... AS REAL)` parce que l'importeur a stocke des nombres dans des colonnes
        // declarees INTEGER *et* dans des colonnes declarees REAL, et que SQLite compare selon
        // le TYPE STOCKE : sans le cast, une valeur ecrite en texte serait comparee comme du
        // texte, ce que le refus ci-dessus vise justement a empecher.
        morceaux.push(format!("CAST(\"{colonne}\" AS REAL) {} ?", sens.sql()));
        params.push(ValeurSql::Real(*valeur));
    }

    for (colonne, present) in &d.presences {
        // `NULL` et la chaine vide comptent pour la meme chose : le miroir melange les deux
        // (`age_group` est vide, pas nul), et publier la nuance publierait une propriete de
        // l'importeur, pas une du jeu.
        morceaux.push(if *present {
            format!("(\"{colonne}\" IS NOT NULL AND \"{colonne}\" != '')")
        } else {
            format!("(\"{colonne}\" IS NULL OR \"{colonne}\" = '')")
        });
    }

    Clause {
        sql: if morceaux.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", morceaux.join(" AND "))
        },
        params,
    }
}

/// Traduit une ligne SQLite en objet JSON, colonne par colonne.
///
/// Les blobs ne sont pas rendus en base64 : ce miroir n'en contient aucun (mesuré le
/// 2026-09-06 : 1 073 colonnes `TEXT`, 332 `INTEGER`, 9 `REAL`, 0 autre), et inventer un
/// encodage pour un cas qui n'existe pas serait du code que rien ne vérifie. Leur taille est
/// rendue, ce qui suffit à voir qu'il y en a un.
///
/// # Errors
///
/// Toute erreur SQLite de lecture de colonne.
pub fn ligne_en_json(
    ligne: &rusqlite::Row<'_>,
    colonnes: &[String],
) -> Result<MapJson<String, ValeurJson>, rusqlite::Error> {
    let mut objet = MapJson::new();
    for (i, nom) in colonnes.iter().enumerate() {
        let valeur = match ligne.get_ref(i)? {
            rusqlite::types::ValueRef::Null => ValeurJson::Null,
            rusqlite::types::ValueRef::Integer(n) => ValeurJson::from(n),
            rusqlite::types::ValueRef::Real(x) => {
                serde_json::Number::from_f64(x).map_or(ValeurJson::Null, ValeurJson::Number)
            }
            rusqlite::types::ValueRef::Text(t) => {
                ValeurJson::String(String::from_utf8_lossy(t).into_owned())
            }
            rusqlite::types::ValueRef::Blob(b) => {
                let mut o = MapJson::new();
                o.insert("blob_octets".to_owned(), ValeurJson::from(b.len()));
                ValeurJson::Object(o)
            }
        };
        objet.insert(nom.clone(), valeur);
    }
    Ok(objet)
}

// --------------------------------------------------------------------------------------------
// Lectures (bloquantes — appelées depuis `spawn_blocking`)
// --------------------------------------------------------------------------------------------

fn schema_table_for_execution(
    connection: &Connection,
    supplied: &TableServie,
) -> Result<TableServie, EntitiesError> {
    let measured = schema_de(connection, supplied.gisement)?
        .into_iter()
        .find(|table| table.nom == supplied.nom)
        .ok_or_else(|| {
            EntitiesError::NotFound(format!(
                "table `{}` is not present in the measured SQLite schema",
                supplied.nom
            ))
        })?;
    if measured != *supplied {
        return Err(EntitiesError::InvalidRequest(
            "table schema does not match the measured SQLite schema".to_owned(),
        ));
    }
    Ok(measured)
}

fn validate_demand_for_execution(
    table: &TableServie,
    demand: &Demande,
) -> Result<(), EntitiesError> {
    let is_column = |name: &str| {
        table.colonnes.iter().any(|column| column.nom == name)
            || (table.cle_implicite && name == table.cle)
    };
    let every_column = demand
        .egalites
        .iter()
        .map(|(name, _)| name)
        .chain(demand.listes.iter().map(|(name, _)| name))
        .chain(demand.bornes.iter().map(|(name, _, _)| name))
        .chain(demand.presences.iter().map(|(name, _)| name))
        .chain(demand.facets.iter());
    let valid = is_column(&demand.tri)
        && every_column.into_iter().all(|name| is_column(name))
        && demand.pagination.page >= 1
        && (1..=PER_PAGE_MAX).contains(&demand.pagination.per_page)
        && demand.facets.len() <= FACETS_MAX
        && demand
            .listes
            .iter()
            .all(|(_, values)| !values.is_empty() && values.len() <= IN_VALEURS_MAX)
        && demand.bornes.iter().all(|(_, _, value)| value.is_finite())
        && demand
            .q
            .as_ref()
            .is_none_or(|_| !table.colonnes_texte().is_empty());
    if !valid {
        return Err(EntitiesError::InvalidRequest(
            "query does not match the measured SQLite schema".to_owned(),
        ));
    }
    Ok(())
}

/// Le catalogue complet, chaque table avec son compte de lignes.
///
/// # Errors
///
/// Toute erreur SQLite.
pub fn catalogue_compte(c: &Connection) -> Result<Vec<TableComptee>, EntitiesError> {
    catalogue_compte_de(c, GISEMENT_EXTRAIT)
}

/// Le catalogue d'une connexion, étiqueté par son gisement.
///
/// # Errors
///
/// Toute erreur SQLite.
pub fn catalogue_compte_de(
    c: &Connection,
    gisement: &'static str,
) -> Result<Vec<TableComptee>, EntitiesError> {
    let mut sortie = Vec::new();
    for table in schema_de(c, gisement)? {
        let n: i64 = c.query_row(
            &format!("SELECT count(*) FROM \"{}\"", table.nom),
            [],
            |r| r.get(0),
        )?;
        sortie.push(TableComptee {
            table,
            lignes: usize::try_from(n).unwrap_or(0),
        });
    }
    Ok(sortie)
}

/// Lit une page de lignes d'une table déjà validée.
///
/// # Errors
///
/// Toute erreur SQLite.
pub fn page_lignes(
    c: &Connection,
    table: &TableServie,
    d: &Demande,
) -> Result<Page<MapJson<String, ValeurJson>>, EntitiesError> {
    let table = schema_table_for_execution(c, table)?;
    validate_demand_for_execution(&table, d)?;
    let table = &table;
    let cl = clause(table, d);
    let total: i64 = c.query_row(
        &format!("SELECT count(*) FROM \"{}\"{}", table.nom, cl.sql),
        rusqlite::params_from_iter(cl.params.iter()),
        |r| r.get(0),
    )?;

    // La clé est projetée explicitement quand elle est implicite : sans elle, la page rend des
    // lignes que `/api/v1/entites/{table}/{id}` ne saurait pas réadresser.
    let projection = if table.cle_implicite {
        "\"rowid\" AS \"rowid\", *"
    } else {
        "*"
    };
    let sql = format!(
        "SELECT {projection} FROM \"{}\"{} ORDER BY \"{}\" {}, {} LIMIT ? OFFSET ?",
        table.nom,
        cl.sql,
        d.tri,
        d.ordre.sql(),
        table.cle_sql(),
    );
    let mut stmt = c.prepare(&sql)?;
    let colonnes: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
    let mut params = cl.params.clone();
    params.push(ValeurSql::Integer(i64::from(d.pagination.per_page)));
    params.push(ValeurSql::Integer(
        i64::try_from(d.pagination.offset()).unwrap_or(i64::MAX),
    ));
    let elements = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| {
            ligne_en_json(r, &colonnes)
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Page::nouvelle(
        elements,
        d.pagination,
        usize::try_from(total).unwrap_or(0),
    ))
}

/// Compte les valeurs de chaque colonne facetée, sous les filtres en cours.
///
/// Un `GROUP BY` par colonne demandée, chacun sous [`clause_sauf`] — c'est-à-dire sous tous les
/// filtres **sauf l'égalité de cette colonne-là** (cf. [`Facet`]). Les valeurs les plus
/// fournies d'abord, à égalité par ordre alphabétique pour que deux appels rendent la même
/// liste.
///
/// `distinct` est compté **avant** la coupe : une facette qui rend 60 valeurs sur 199 le dit,
/// au lieu de laisser croire que la colonne n'en porte que 60.
///
/// # Errors
///
/// Toute erreur SQLite.
pub fn facettes(
    c: &Connection,
    table: &TableServie,
    d: &Demande,
) -> Result<Vec<Facet>, EntitiesError> {
    let table = schema_table_for_execution(c, table)?;
    validate_demand_for_execution(&table, d)?;
    let table = &table;
    let mut sorties = Vec::with_capacity(d.facets.len());
    for colonne in &d.facets {
        let cl = clause_sauf(table, d, Some(colonne));
        // `NULL` et la chaine vide sont rendus comme UNE seule valeur nulle : le miroir melange
        // les deux (`age_group` est vide, pas nul), et les distinguer publierait une propriete
        // de l'importeur, pas une du jeu. Meme choix que les tests de presence.
        let expr = format!("nullif(\"{colonne}\", '')");
        // Le compte distinct passe par le MEME `GROUP BY` que la liste, pas par un
        // `count(DISTINCT ...)` : ce dernier ignore les `NULL`, si bien qu'une colonne dont la
        // moitie des lignes est vide se serait annoncee avec une valeur distincte de moins que
        // celles qu'elle rend. Ici les deux requetes voient exactement les memes groupes.
        let distinct: i64 = c.query_row(
            &format!(
                "SELECT count(*) FROM (SELECT {expr} AS v FROM \"{}\"{} GROUP BY v)",
                table.nom, cl.sql
            ),
            rusqlite::params_from_iter(cl.params.iter()),
            |r| r.get(0),
        )?;

        let sql = format!(
            "SELECT {expr} AS v, count(*) AS n FROM \"{}\"{} GROUP BY v \
             ORDER BY n DESC, v IS NULL, v ASC LIMIT ?",
            table.nom, cl.sql
        );
        let mut stmt = c.prepare(&sql)?;
        let mut params = cl.params.clone();
        params.push(ValeurSql::Integer(
            i64::try_from(FACET_VALEURS_MAX).unwrap_or(i64::MAX),
        ));
        let values = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                Ok(FacetValeur {
                    value: r.get::<_, Option<String>>(0)?,
                    count: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let distinct = usize::try_from(distinct).unwrap_or(values.len());
        sorties.push(Facet {
            column: colonne.clone(),
            distinct,
            truncated: values.len() < distinct,
            values,
        });
    }
    Ok(sorties)
}

/// Lit une ligne par sa clé.
///
/// # Errors
///
/// `Introuvable` quand aucune ligne ne porte cette clé, ou quand la clé est un `rowid` et que
/// la valeur demandée n'est pas un entier.
pub fn lire_ligne(
    c: &Connection,
    table: &TableServie,
    id: &str,
) -> Result<MapJson<String, ValeurJson>, EntitiesError> {
    let table = schema_table_for_execution(c, table)?;
    let table = &table;
    let valeur = if table.cle_implicite {
        let n = id.parse::<i64>().map_err(|_| {
            EntitiesError::NotFound(format!(
                "`{}` s'adresse par son rowid, un entier ; `{id}` n'en est pas un",
                table.nom
            ))
        })?;
        ValeurSql::Integer(n)
    } else {
        ValeurSql::Text(id.to_owned())
    };

    let projection = if table.cle_implicite {
        "\"rowid\" AS \"rowid\", *"
    } else {
        "*"
    };
    let sql = format!(
        "SELECT {projection} FROM \"{}\" WHERE {} = ? LIMIT 1",
        table.nom,
        table.cle_sql()
    );
    let mut stmt = c.prepare(&sql)?;
    let colonnes: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
    let mut lignes = stmt.query(rusqlite::params_from_iter([valeur].iter()))?;
    match lignes.next()? {
        Some(r) => Ok(ligne_en_json(r, &colonnes)?),
        None => Err(EntitiesError::NotFound(format!(
            "aucune ligne de `{}` ne porte `{}` = `{id}`",
            table.nom, table.cle
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE characters(id TEXT PRIMARY KEY, name TEXT, element TEXT, power INTEGER, payload BLOB);
                 INSERT INTO characters VALUES ('c1', 'Mark', 'fire', 10, x'010203');
                 INSERT INTO characters VALUES ('c2', 'Axel', 'fire', 20, NULL);
                 INSERT INTO characters VALUES ('c3', 'Jude', 'wood', 30, NULL);
                 CREATE TABLE links(left_id TEXT, right_id TEXT);",
            )
            .unwrap();
        connection
    }

    fn parameters(values: &[(&str, &str)]) -> BTreeMap<String, String> {
        values
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn schema_measures_primary_and_implicit_keys() {
        let tables = schema(&database()).unwrap();
        let characters = trouver(&tables, "characters").unwrap();
        assert_eq!(characters.cle, "id");
        assert!(!characters.cle_implicite);
        let links = trouver(&tables, "links").unwrap();
        assert_eq!(links.cle, "rowid");
        assert!(links.cle_implicite);
    }

    #[test]
    fn query_facets_and_pagination_execute_in_the_owner() {
        let connection = database();
        let tables = schema(&connection).unwrap();
        let table = trouver(&tables, "characters").unwrap();
        let demand = analyser(
            table,
            &parameters(&[
                ("element", "fire"),
                ("power__min", "10"),
                ("facets", "element"),
                ("per_page", "1"),
                ("ordre", "desc"),
            ]),
        )
        .unwrap();
        let page = page_lignes(&connection, table, &demand).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.elements.len(), 1);
        assert_eq!(page.pages, 2);
        let facets = facettes(&connection, table, &demand).unwrap();
        assert_eq!(facets.len(), 1);
        assert_eq!(facets[0].distinct, 2);
    }

    #[test]
    fn blobs_are_bounded_metadata_not_encoded_content() {
        let connection = database();
        let tables = schema(&connection).unwrap();
        let table = trouver(&tables, "characters").unwrap();
        let row = lire_ligne(&connection, table, "c1").unwrap();
        assert_eq!(row["payload"]["blob_octets"], 3);
    }

    #[test]
    fn fabricated_table_and_query_identifiers_never_reach_sql() {
        let connection = database();
        let tables = schema(&connection).unwrap();
        let trusted = trouver(&tables, "characters").unwrap();
        let demand = analyser(trusted, &BTreeMap::new()).unwrap();

        let mut fabricated_table = trusted.clone();
        fabricated_table.nom = "characters\"; DROP TABLE characters; --".to_owned();
        assert!(matches!(
            page_lignes(&connection, &fabricated_table, &demand),
            Err(EntitiesError::NotFound(_))
        ));

        let mut fabricated_query = demand;
        fabricated_query.tri = "id\"; DROP TABLE characters; --".to_owned();
        assert!(matches!(
            page_lignes(&connection, trusted, &fabricated_query),
            Err(EntitiesError::InvalidRequest(_))
        ));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM characters", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            3
        );
    }

    #[test]
    fn sqlite_error_display_does_not_expose_driver_details() {
        let error = EntitiesError::from(rusqlite::Error::InvalidQuery);
        assert_eq!(error.to_string(), "SQLite entity read failed");
        assert!(std::error::Error::source(&error).is_some());
    }
}
