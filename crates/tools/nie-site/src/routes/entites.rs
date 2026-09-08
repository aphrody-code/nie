//! `/api/v1/entites` — la lecture **générique** du miroir SQLite (`var/mirror.sqlite`).
//!
//! Le gisement `extrait` porte 219 tables `inagle_*` et 165 249 lignes. Jusqu'ici le site n'en
//! servait qu'une poignée, chacune par une route écrite à la main (`/api/v1/chara`,
//! `/api/v1/3d/perso`, …) : tout le reste — les 153 tables `inagle_cross_*`, les inventaires
//! d'icônes, les tables de drop, les boutiques — était présent sur la machine et inatteignable.
//! Écrire 219 routes n'était pas la réponse ; une route qui **mesure** le schéma en est une.
//!
//! Trois routes, et rien d'autre :
//!
//! | Route | Ce qu'elle rend |
//! |---|---|
//! | `GET /api/v1/entites` | le catalogue : les tables servables, leurs colonnes, leur compte de lignes |
//! | `GET /api/v1/entites/{table}` | une page de lignes, filtrée, triée, bornée |
//! | `GET /api/v1/entites/{table}/{id}` | une ligne, par sa clé |
//!
//! ## Ce qui rend l'exercice sûr
//!
//! Une route générique sur une base, c'est une injection SQL si on la construit naïvement. La
//! règle tenue ici est **structurelle**, pas déclarative :
//!
//! - **aucun nom de table ni de colonne ne vient du client**. Le client fournit une chaîne ;
//!   cette chaîne sert à *retrouver* une entrée dans le catalogue mesuré sur `sqlite_master` et
//!   `PRAGMA table_info`, et c'est le nom **du catalogue** — donc de la base — qui est écrit
//!   dans le SQL. Une table inconnue est un `404`, une colonne inconnue un `400` : jamais une
//!   requête exécutée ;
//! - **toutes les valeurs sont des paramètres liés**. Il n'y a pas une seule valeur du client
//!   dans le texte d'une requête, y compris dans le motif `LIKE` (dont les jokers `%` et `_`
//!   sont d'ailleurs échappés — un `%` tapé par un humain est un pourcent) ;
//! - la connexion est ouverte en `SQLITE_OPEN_READ_ONLY` par [`crate::dataset::Gisement`], qui
//!   porte aussi la parade au lien symbolique rebasculé chaque nuit. Aucune seconde connexion
//!   n'est ouverte ici.
//!
//! ## Un paramètre accepté est un paramètre honoré
//!
//! Le dépôt a déjà payé le contraire (`/b` déclarait `q` et ne l'appliquait pas : un client qui
//! filtre croit filtrer, et la liste entière passe pour un résultat). Donc :
//!
//! - `tri` sur une colonne inconnue est un `400`, jamais un tri silencieusement ignoré ;
//! - `ordre` hors de `asc`/`desc` est un `400` ;
//! - `q` sur une table **sans aucune colonne texte** est un `400` qui le dit, plutôt qu'un
//!   filtre qui ne filtre rien (c'est le cas de `inagle_exp_table`, la seule des 219) ;
//! - un filtre à valeur vide (`?element=`) est un `400` : ni « pas de filtre » ni « égal à la
//!   chaîne vide » ne sont devinables, et deviner serait mentir dans un sens ou dans l'autre ;
//! - la réponse republie ce qui a été appliqué (`filtres`), pour qu'un client puisse le vérifier
//!   sans relire ce fichier.
//!
//! ## Trois formes de filtre, parce que l'égalité seule ment par omission
//!
//! `scripts/validation/mesurer-matrice-filtres.sh` a mesuré le 2026-09-06 que deux des quatorze
//! manques restants n'étaient pas des données absentes mais des **formes** que cette route ne
//! savait pas exprimer : « puissance entre 400 et 880 » et « a une vidéo ». Les colonnes
//! existaient ; seule l'égalité était servie, et l'égalité ne sait dire ni l'intervalle ni la
//! présence. Une facette qui n'existe pas est un manque visible ; une facette qu'on approxime
//! par l'égalité est un résultat faux.
//!
//! | Forme | Écriture | Sur quelles colonnes |
//! |---|---|---|
//! | Égalité | `?element=Feu` | toutes |
//! | Intervalle | `?power_max__min=400&power_max__max=880` | **numériques seulement** |
//! | Présence | `?video_url=__present__` / `__absent__` | toutes |
//!
//! Chacune refuse plutôt que d'approximer, et c'est le point :
//!
//! - `__min`/`__max` sur une colonne **texte** est un `400`. SQLite comparerait volontiers
//!   `'Mark' >= '400'` par ordre lexicographique et rendrait une page pleine de lignes
//!   plausibles : le pire résultat possible, faux sans en avoir l'air ;
//! - une borne non numérique est un `400` ;
//! - `__present__` compte `NULL` **et** la chaîne vide comme absents. Le miroir mélange les deux
//!   (`age_group` est vide, pas nul, sur les 6 166 personnages) ; distinguer un `NULL` d'un `''`
//!   ici publierait une nuance de l'importeur, pas une du jeu ;
//! - un `?colonne=__present__` sur une colonne qui contiendrait littéralement la chaîne
//!   `__present__` serait détourné. Mesuré avant d'écrire : **0 occurrence** des deux jetons
//!   dans les 165 249 lignes des 219 tables.
//!
//! ## L'export : la même page, dans un autre format
//!
//! `?format=csv` rend la page **exactement telle qu'elle est filtrée et triée**, en CSV, avec
//! un `Content-Disposition` dont le nom porte la table et la page — jamais un nom générique,
//! sinon deux exports se recouvrent dans le dossier de téléchargement (leçon déjà payée sur
//! les cues audio).
//!
//! Ce n'est pas un dump : la pagination continue de s'appliquer, `per_page` reste plafonné, et
//! l'export d'un corpus entier passe par autant d'appels que de pages. Un export qui
//! ignorerait la pagination serait une seconde route déguisée, avec un coût que personne
//! n'aurait choisi.
//!
//! Sans miroir, les trois routes répondent `503` avec la raison : le service démarre toujours.

use std::collections::BTreeMap;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::header;
use axum::response::IntoResponse;
use rusqlite::Connection;
use serde_json::{Map as MapJson, Value as ValeurJson};

use crate::error::ErreurSite;
use crate::state::EtatSite;
use nie_wiki::entities as shared;

pub use shared::{
    Borne, CatalogueEntites, Colonne, Demande, FACET_VALEURS_MAX, FACETS_MAX, FORMATS, Facet,
    FacetValeur, FiltresAppliques, GISEMENT_ANIME, GISEMENT_EXTRAIT, IN_VALEURS_MAX, JETON_ABSENT,
    JETON_PRESENT, LigneUnique, NOM_MAX, Ordre, PARAMS_RESERVES, PREFIXE_INTERNE, Page, PageLignes,
    Pagination, SUFFIXE_IN, SUFFIXE_MAX, SUFFIXE_MIN, TableComptee, TableServie, cle_primaire,
    colonne_texte, ligne_en_json, nom_sql_valide,
};

impl From<shared::EntitiesError> for ErreurSite {
    fn from(error: shared::EntitiesError) -> Self {
        match error {
            shared::EntitiesError::NotFound(message) => Self::Introuvable(message),
            shared::EntitiesError::InvalidRequest(message) => Self::Demande(message),
            shared::EntitiesError::Sqlite(error) => error.into(),
        }
    }
}

/// Read the mirror schema through the shared data owner.
pub fn schema(c: &Connection) -> Result<Vec<TableServie>, ErreurSite> {
    shared::schema(c).map_err(Into::into)
}

/// Read a schema and attach its public dataset label.
pub fn schema_de(c: &Connection, gisement: &'static str) -> Result<Vec<TableServie>, ErreurSite> {
    shared::schema_de(c, gisement).map_err(Into::into)
}

/// Resolve a requested table against the measured shared catalogue.
pub fn trouver<'a>(
    catalogue: &'a [TableServie],
    demande: &str,
) -> Result<&'a TableServie, ErreurSite> {
    shared::trouver(catalogue, demande).map_err(Into::into)
}

/// Validate HTTP query parameters through the shared query contract.
pub fn analyser(
    table: &TableServie,
    brut: &BTreeMap<String, String>,
) -> Result<Demande, ErreurSite> {
    shared::analyser(table, brut).map_err(Into::into)
}

/// Count every public table in the mirror.
pub fn catalogue_compte(c: &Connection) -> Result<Vec<TableComptee>, ErreurSite> {
    shared::catalogue_compte(c).map_err(Into::into)
}

/// Count every public table in a labelled dataset.
pub fn catalogue_compte_de(
    c: &Connection,
    gisement: &'static str,
) -> Result<Vec<TableComptee>, ErreurSite> {
    shared::catalogue_compte_de(c, gisement).map_err(Into::into)
}

/// Execute a validated paginated entity query.
pub fn page_lignes(
    c: &Connection,
    table: &TableServie,
    demande: &Demande,
) -> Result<Page<MapJson<String, ValeurJson>>, ErreurSite> {
    shared::page_lignes(c, table, demande).map_err(Into::into)
}

/// Execute the requested facets for a validated entity query.
pub fn facettes(
    c: &Connection,
    table: &TableServie,
    demande: &Demande,
) -> Result<Vec<Facet>, ErreurSite> {
    shared::facettes(c, table, demande).map_err(Into::into)
}

/// Read one entity row by its measured key.
pub fn lire_ligne(
    c: &Connection,
    table: &TableServie,
    id: &str,
) -> Result<MapJson<String, ValeurJson>, ErreurSite> {
    shared::lire_ligne(c, table, id).map_err(Into::into)
}

// --------------------------------------------------------------------------------------------
// Handlers
// --------------------------------------------------------------------------------------------

/// `GET /api/v1/entites` — le catalogue des tables servables.
///
/// Chaque compte est **mesuré** à la demande, jamais écrit à la main : le miroir est régénéré
/// chaque nuit, et une liste versionnée annoncerait des tables disparues ou tairait les
/// nouvelles.
///
/// # Errors
///
/// `503` quand le miroir est absent, `500` sur erreur SQLite.
pub async fn catalogue(
    State(etat): State<EtatSite>,
    Query(brut): Query<BTreeMap<String, String>>,
) -> Result<Json<CatalogueEntites>, ErreurSite> {
    let gisement = std::sync::Arc::clone(&etat.gisement);
    let anime = std::sync::Arc::clone(&etat.anime);
    let (tables, pagination, motif) = tokio::task::spawn_blocking(move || {
        let page = brut.get("page").and_then(|v| v.trim().parse::<u32>().ok());
        let par_page = brut
            .get("par_page")
            .or_else(|| brut.get("per_page"))
            .and_then(|v| v.trim().parse::<u32>().ok());
        let motif = brut
            .get("q")
            .map(|v| v.trim().to_lowercase())
            .filter(|v| !v.is_empty());
        // Les deux gisements sont concaténés, jamais fusionnés : chaque table dit d'où elle
        // vient. Un gisement absent n'est pas une erreur — il manque de son catalogue, et le
        // reste répond. C'est la même règle qu'au démarrage : un corpus absent dégrade, il
        // n'éteint pas.
        let mut t = gisement.lire(catalogue_compte)?;
        if anime.present() {
            t.extend(anime.lire(|c| catalogue_compte_de(c, GISEMENT_ANIME))?);
        }
        Ok::<_, ErreurSite>((t, Pagination::borner(page, par_page), motif))
    })
    .await??;

    let retenues: Vec<&TableComptee> = tables
        .iter()
        .filter(|t| {
            motif
                .as_ref()
                .is_none_or(|m| t.table.nom.to_lowercase().contains(m))
        })
        .collect();
    let lignes_totales = retenues.iter().map(|t| t.lignes).sum();
    let total = retenues.len();
    let elements: Vec<TableComptee> = retenues
        .into_iter()
        .skip(pagination.offset())
        .take(pagination.per_page as usize)
        .cloned()
        .collect();

    Ok(Json(CatalogueEntites {
        page: Page::nouvelle(elements, pagination, total),
        lignes_totales,
        route_lignes: "/api/v1/entites/{table}",
        route_ligne: "/api/v1/entites/{table}/{id}",
    }))
}

/// `GET /api/v1/entites/{table}` — une page de lignes.
///
/// # Errors
///
/// `404` si la table n'est pas servie, `400` sur un paramètre que la route ne peut pas honorer,
/// `503` sans miroir.
pub async fn lignes(
    State(etat): State<EtatSite>,
    Path(nom): Path<String>,
    Query(brut): Query<BTreeMap<String, String>>,
) -> Result<axum::response::Response, ErreurSite> {
    let gisement = std::sync::Arc::clone(&etat.gisement);
    let anime = std::sync::Arc::clone(&etat.anime);
    tokio::task::spawn_blocking(move || {
        let csv = match brut.get("format").map(|v| v.trim().to_ascii_lowercase()) {
            None => false,
            Some(f) if f == "json" => false,
            Some(f) if f == "csv" => true,
            Some(f) => {
                return Err(ErreurSite::Demande(format!(
                    "`format={f}` : seuls {} sont servis",
                    FORMATS.join(" et ")
                )));
            }
        };
        dans_le_gisement(&gisement, &anime, &nom, |c, table| {
            let demande = analyser(table, &brut)?;
            let page = page_lignes(c, table, &demande)?;
            let corps = PageLignes {
                page,
                gisement: table.gisement,
                table: table.nom.clone(),
                cle: table.cle.clone(),
                filtres: demande.appliques(),
                facets: facettes(c, table, &demande)?,
            };
            Ok(if csv {
                reponse_csv(&corps)
            } else {
                Json(corps).into_response()
            })
        })
    })
    .await?
}

/// Rend une page en CSV, avec le nom de fichier qui la désigne.
///
/// Les colonnes sont l'UNION des clés rencontrées, dans l'ordre stable de `serde_json::Map` —
/// une ligne du miroir peut omettre une colonne nulle, et prendre les clés de la première
/// ligne perdrait silencieusement les colonnes suivantes.
fn reponse_csv(p: &PageLignes) -> axum::response::Response {
    let mut colonnes: Vec<String> = Vec::new();
    for ligne in &p.page.elements {
        for cle in ligne.keys() {
            if !colonnes.iter().any(|c| c == cle) {
                colonnes.push(cle.clone());
            }
        }
    }
    let mut corps = String::new();
    corps.push_str(
        &colonnes
            .iter()
            .map(|c| echapper_csv(c))
            .collect::<Vec<_>>()
            .join(","),
    );
    corps.push('\n');
    for ligne in &p.page.elements {
        let cellules: Vec<String> = colonnes
            .iter()
            .map(|c| match ligne.get(c) {
                None | Some(ValeurJson::Null) => String::new(),
                Some(ValeurJson::String(s)) => echapper_csv(s),
                Some(v) => echapper_csv(&v.to_string()),
            })
            .collect();
        corps.push_str(&cellules.join(","));
        corps.push('\n');
    }
    // Le nom porte la TABLE et la PAGE : sans la seconde, deux exports du même corpus se
    // recouvrent dans le dossier de téléchargement et le lecteur croit n'en avoir qu'un.
    let nom = format!("{}-page{}.csv", p.table, p.page.page);
    let mut reponse = ([(header::CONTENT_TYPE, "text/csv; charset=utf-8")], corps).into_response();
    if let Ok(v) = format!("attachment; filename=\"{nom}\"").parse() {
        reponse.headers_mut().insert(header::CONTENT_DISPOSITION, v);
    }
    reponse
}

/// Échappe une cellule CSV selon RFC 4180.
///
/// Le guillemet se double, et toute cellule qui porte une virgule, un guillemet ou un saut de
/// ligne est encadrée. Les descriptions du jeu contiennent les trois : sans cet échappement,
/// une seule ligne décale toutes les colonnes de la suivante, et le fichier s'ouvre
/// « correctement » avec des valeurs dans les mauvaises cases.
fn echapper_csv(v: &str) -> String {
    if v.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", v.replace('"', "\"\""))
    } else {
        v.to_owned()
    }
}

/// Exécute une lecture sur le gisement qui porte cette table, le miroir d'abord.
///
/// L'ordre n'est pas arbitraire : le miroir est le corpus de loin le plus consulté (219 tables
/// contre 5), et ses noms sont préfixés `inagle_`, donc aucune collision n'est possible avec
/// ceux de la série. Le second gisement n'est ouvert que si le premier ne connaît pas le nom.
///
/// # Errors
///
/// `404` si aucun des deux ne sert cette table — avec le compte des deux catalogues, pour que
/// le message ne laisse pas croire qu'un seul a été consulté.
pub fn dans_le_gisement<T>(
    miroir: &crate::dataset::Gisement,
    anime: &crate::dataset::Gisement,
    nom: &str,
    f: impl FnOnce(&Connection, &TableServie) -> Result<T, ErreurSite>,
) -> Result<T, ErreurSite> {
    // `Option` puis `take` : `f` est un `FnOnce` et ne peut pas entrer dans deux fermetures,
    // alors qu'il n'est appelé qu'une fois — sur le gisement qui porte la table.
    let mut f = Some(f);
    let mut connues = 0usize;
    let mut premiere_erreur = None;
    let mut consulte = 0usize;

    for (gisement, etiquette) in [(miroir, GISEMENT_EXTRAIT), (anime, GISEMENT_ANIME)] {
        // Un gisement absent n'éteint pas la route : il manque de son catalogue, l'autre
        // répond. C'est la même règle qu'au démarrage — un corpus absent dégrade.
        if !gisement.present() {
            continue;
        }
        consulte += 1;
        let sortie = gisement.lire(|c| {
            let catalogue = schema_de(c, etiquette)?;
            let n = catalogue.len();
            match catalogue.iter().find(|t| t.nom.eq_ignore_ascii_case(nom)) {
                Some(table) if nom_sql_valide(nom) => {
                    // `take` ne peut rendre `None` ici : la boucle sort dès qu'il a servi.
                    let r = f.take().expect("f n'est consommee qu'une fois")(c, table)?;
                    Ok((Some(r), n))
                }
                _ => Ok((None, n)),
            }
        });
        match sortie {
            Ok((Some(v), _)) => return Ok(v),
            Ok((None, n)) => connues += n,
            // Une erreur APRES que `f` ait ete consommee vient de `f`, pas de la recherche :
            // c'est le `400` d'un `tri=` sur une colonne inconnue, ou une panne SQLite sur la
            // bonne table. La retenir pour continuer la boucle la transformerait en `404`
            // « aucune table ne se nomme ainsi » — un message qui envoie corriger un nom de
            // table parfaitement juste. Mesure du 2026-09-06 : c'est exactement ce que la
            // premiere version faisait sur `entites/episodes?tri=pertinence`.
            Err(e) if f.is_none() => return Err(e),
            Err(e) => {
                premiere_erreur.get_or_insert(e);
            }
        }
    }

    // Aucun gisement lisible : c'est une indisponibilité, pas un 404. Les confondre ferait
    // passer une panne — ou un miroir qui n'a pas encore tourné — pour une table inexistante,
    // et un client corrigerait alors son URL au lieu d'attendre. Deux causes, même conclusion :
    // aucun fichier sur le disque, ou tous illisibles.
    if consulte == 0 {
        return Err(ErreurSite::Indisponible(format!(
            "aucun gisement n'est monte : ni le miroir ({}) ni le catalogue de la serie ({})",
            miroir.chemin().display(),
            anime.chemin().display()
        )));
    }
    if connues == 0
        && let Some(e) = premiere_erreur
    {
        return Err(e);
    }
    Err(ErreurSite::Introuvable(format!(
        "aucune des {connues} tables servies ne se nomme `{nom}` ; elles sont sur /api/v1/entites"
    )))
}

/// `GET /api/v1/entites/{table}/{id}` — une ligne par sa clé.
///
/// # Errors
///
/// `404` si la table n'est pas servie ou si aucune ligne ne porte cette clé, `503` sans miroir.
pub async fn ligne(
    State(etat): State<EtatSite>,
    Path((nom, id)): Path<(String, String)>,
) -> Result<Json<LigneUnique>, ErreurSite> {
    let gisement = std::sync::Arc::clone(&etat.gisement);
    let anime = std::sync::Arc::clone(&etat.anime);
    tokio::task::spawn_blocking(move || {
        dans_le_gisement(&gisement, &anime, &nom, |c, table| {
            let ligne = lire_ligne(c, table, &id)?;
            Ok(Json(LigneUnique {
                gisement: table.gisement,
                table: table.nom.clone(),
                cle: table.cle.clone(),
                id,
                ligne,
            }))
        })
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une base de test qui reproduit les trois formes de clé rencontrées sur le miroir :
    /// une table à `id`, une table à clé primaire déclarée, une table sans ni l'un ni l'autre
    /// (donc `rowid`), plus une table sans aucune colonne texte.
    fn base() -> (tempfile::TempDir, crate::dataset::Gisement) {
        let dir = tempfile::tempdir().unwrap();
        let chemin = dir.path().join("mirror.sqlite");
        let c = Connection::open(&chemin).unwrap();
        c.execute_batch(
            "CREATE TABLE _meta(cle TEXT, valeur TEXT);
             INSERT INTO _meta VALUES ('source', 'pg:DATABASE_URL');
             CREATE TABLE inagle_characters(id TEXT, name_fr TEXT, element TEXT, zukan INTEGER);
             INSERT INTO inagle_characters VALUES ('c1', 'Mark', 'Feu', 1);
             INSERT INTO inagle_characters VALUES ('c2', 'Axel', 'Feu', 2);
             INSERT INTO inagle_characters VALUES ('c3', 'Jude', 'Bois', 3);
             CREATE TABLE inagle_skills(code TEXT PRIMARY KEY, libelle TEXT);
             INSERT INTO inagle_skills VALUES ('s1', 'Tornade');
             CREATE TABLE inagle_liens(source TEXT, cible TEXT);
             INSERT INTO inagle_liens VALUES ('a', 'b');
             CREATE TABLE inagle_exp_table(niveau INTEGER, exp INTEGER);
             INSERT INTO inagle_exp_table VALUES (1, 0);",
        )
        .unwrap();
        drop(c);
        let g = crate::dataset::Gisement::nouveau(&chemin);
        (dir, g)
    }

    fn q(paires: &[(&str, &str)]) -> BTreeMap<String, String> {
        paires
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    /// Retrouve une table du catalogue de test.
    fn table_de(g: &crate::dataset::Gisement, nom: &str) -> TableServie {
        g.lire(catalogue_compte)
            .unwrap()
            .into_iter()
            .map(|t| t.table)
            .find(|t| t.nom == nom)
            .unwrap()
    }

    /// Compte les lignes que rend une demande via l'execution partagee.
    fn compter(g: &crate::dataset::Gisement, table: &TableServie, d: &Demande) -> usize {
        g.lire(|c| Ok(page_lignes(c, table, d)?.total)).unwrap()
    }

    /// Calcule les facettes d'une demande sur un gisement de test.
    fn faceter(g: &crate::dataset::Gisement, table: &TableServie, d: &Demande) -> Vec<Facet> {
        let table = table.clone();
        let d = d.clone();
        g.lire(move |c| facettes(c, &table, &d)).unwrap()
    }

    /// Retrouve une valeur de facette par son libellé, ou `None` si la facette ne la porte pas.
    fn compte_de(f: &Facet, valeur: &str) -> Option<i64> {
        f.values
            .iter()
            .find(|v| v.value.as_deref() == Some(valeur))
            .map(|v| v.count)
    }

    #[test]
    fn une_facette_compte_les_valeurs_sous_les_filtres_en_cours() {
        // Une facette qui ne verrait pas les filtres rendrait les mêmes comptes que la table
        // entière — des chiffres justes à côté d'un écran qui n'en montre pas autant. Les deux
        // moitiés sont nécessaires : sans le cas filtré, une implémentation qui ignore la
        // clause passerait aussi.
        let (_d, g) = base();
        let t = table_de(&g, "inagle_characters");

        let large = faceter(&g, &t, &analyser(&t, &q(&[("facets", "element")])).unwrap());
        assert_eq!(large.len(), 1);
        assert_eq!(large[0].column, "element");
        assert_eq!(large[0].distinct, 2);
        assert!(!large[0].truncated);
        assert_eq!(compte_de(&large[0], "Feu"), Some(2));
        assert_eq!(compte_de(&large[0], "Bois"), Some(1));

        // `q=Mark` ne retient que `c1`, donc la facette ne doit plus voir qu'un `Feu` — et plus
        // du tout de `Bois` : une valeur qui rendrait zéro ligne ne se propose pas.
        let etroit = faceter(
            &g,
            &t,
            &analyser(&t, &q(&[("facets", "element"), ("q", "Mark")])).unwrap(),
        );
        assert_eq!(compte_de(&etroit[0], "Feu"), Some(1));
        assert_eq!(compte_de(&etroit[0], "Bois"), None);
        assert_eq!(etroit[0].distinct, 1);
    }

    #[test]
    fn une_facette_ignore_le_filtre_de_sa_propre_colonne() {
        // LA propriété qui rend une facette multi-sélectionnable. Sous `?element=Feu`, une
        // facette calculée avec TOUS les filtres ne rendrait que `Feu` — et l'interface ne
        // pourrait plus proposer d'ajouter `Bois`, c'est-à-dire qu'un filtre choisi fermerait
        // la porte à tous les autres. C'est `clause_sauf` qui l'évite, et ce test rougit si
        // l'appel repasse par `clause`.
        let (_d, g) = base();
        let t = table_de(&g, "inagle_characters");
        let d = analyser(&t, &q(&[("facets", "element"), ("element", "Feu")])).unwrap();

        // La page, elle, EST filtrée : les deux comptes disent bien deux choses différentes.
        assert_eq!(compter(&g, &t, &d), 2);

        let f = faceter(&g, &t, &d);
        assert_eq!(compte_de(&f[0], "Feu"), Some(2));
        assert_eq!(
            compte_de(&f[0], "Bois"),
            Some(1),
            "la facette doit continuer d'offrir les autres valeurs de sa propre colonne"
        );

        // Mais un filtre sur une AUTRE colonne s'applique bien à elle : sinon les comptes ne
        // correspondraient plus à l'écran.
        let croise = analyser(
            &t,
            &q(&[
                ("facets", "element"),
                ("element", "Feu"),
                ("zukan__max", "1"),
            ]),
        )
        .unwrap();
        let f = faceter(&g, &t, &croise);
        assert_eq!(compte_de(&f[0], "Feu"), Some(1));
        assert_eq!(compte_de(&f[0], "Bois"), None);
    }

    #[test]
    fn une_facette_sur_une_colonne_inconnue_est_refusee() {
        // Le piège n° 1 de ce dépôt : un paramètre accepté et jamais appliqué. Un client qui
        // demande une facette inexistante doit recevoir un 400, pas une réponse sans le champ
        // — il croirait que la colonne n'a aucune valeur.
        let (_d, g) = base();
        let t = table_de(&g, "inagle_characters");
        let e = analyser(&t, &q(&[("facets", "couleur_preferee")])).unwrap_err();
        assert!(
            matches!(&e, ErreurSite::Demande(m) if m.contains("couleur_preferee")),
            "attendu un 400 nommant la colonne, recu {e:?}"
        );

        // Et la liste est bornée : au-delà, c'est le schéma qui est demandé.
        let colonnes = vec!["id"; FACETS_MAX + 1].join(",");
        assert!(
            analyser(&t, &q(&[("facets", colonnes.as_str())])).is_ok(),
            "les doublons se dedupliquent avant d'etre comptes"
        );
    }

    #[test]
    fn un_choix_multiple_prend_l_union_de_ses_valeurs() {
        // L'affordance que la facette dessine : elle offre les autres valeurs de sa colonne, il
        // faut donc pouvoir en cocher une seconde. Les trois cas comptent — une valeur seule
        // doit rendre comme une egalite, deux doivent rendre leur SOMME, et une valeur absente
        // ne doit rien ajouter. Sans le troisieme, un `IN` qui ignorerait la liste et rendrait
        // tout passerait aussi.
        let (_d, g) = base();
        let t = table_de(&g, "inagle_characters");
        for (query, attendu) in [
            (vec![("element__in", "Feu")], 2),
            (vec![("element__in", "Bois")], 1),
            (vec![("element__in", "Feu,Bois")], 3),
            (vec![("element__in", "Feu,Vent")], 2),
            (vec![("element__in", "Vent")], 0),
            // Les espaces autour d'une valeur viennent d'une URL ecrite a la main : on les
            // retire, sans quoi `Feu, Bois` chercherait une valeur ` Bois` qui n'existe pas.
            (vec![("element__in", "Feu , Bois")], 3),
            // Le doublon ne double pas le compte : `IN` est un ensemble.
            (vec![("element__in", "Feu,Feu")], 2),
            // Croise avec un autre filtre : les deux s'appliquent.
            (vec![("element__in", "Feu,Bois"), ("zukan__max", "2")], 2),
        ] {
            let d = analyser(&t, &q(&query)).unwrap();
            assert_eq!(compter(&g, &t, &d), attendu, "pour {query:?}");
        }
    }

    #[test]
    fn un_choix_multiple_vide_ou_inconnu_est_refuse() {
        // Trois refus plutot que trois approximations. Un `__in` vide filtrerait sur rien tout
        // en ayant l'air de filtrer ; une colonne inconnue laisserait croire qu'elle n'a aucune
        // valeur ; une liste au-dela de la borne serait tronquee en silence et rendrait des
        // lignes justes pour une question qui n'a pas ete posee.
        let (_d, g) = base();
        let t = table_de(&g, "inagle_characters");
        assert!(
            analyser(&t, &q(&[("element__in", " , ")])).is_err(),
            "liste vide"
        );
        assert!(
            analyser(&t, &q(&[("couleur__in", "x")])).is_err(),
            "colonne inconnue"
        );
        let trop = (0..=IN_VALEURS_MAX)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",");
        assert!(
            analyser(&t, &q(&[("element__in", trop.as_str())])).is_err(),
            "liste trop longue"
        );

        // Et il republie ce qu'il a applique, sous le nom que le client a envoye.
        let d = analyser(&t, &q(&[("element__in", "Feu,Bois")])).unwrap();
        assert_eq!(
            d.appliques().listes.get("element__in").map(Vec::as_slice),
            Some(["Feu".to_owned(), "Bois".to_owned()].as_slice())
        );
    }

    #[test]
    fn une_facette_ignore_aussi_le_choix_multiple_de_sa_colonne() {
        // Meme propriete que pour l'egalite, et c'est celle qui compte le plus ici : sans elle,
        // cocher `Feu` puis rouvrir la facette ne montrerait plus `Bois`, et on ne pourrait
        // jamais cocher la deuxieme valeur.
        let (_d, g) = base();
        let t = table_de(&g, "inagle_characters");
        let d = analyser(&t, &q(&[("facets", "element"), ("element__in", "Feu")])).unwrap();
        assert_eq!(compter(&g, &t, &d), 2, "la page, elle, est bien filtree");
        let f = faceter(&g, &t, &d);
        assert_eq!(compte_de(&f[0], "Feu"), Some(2));
        assert_eq!(
            compte_de(&f[0], "Bois"),
            Some(1),
            "la seconde valeur reste cochable"
        );
    }

    #[test]
    fn une_facette_groupe_le_vide_avec_le_nul() {
        // Le miroir mélange les deux — `age_group` est vide, pas nul — et publier la nuance
        // publierait une propriété de l'importeur, pas une du jeu. Même choix que les tests de
        // présence, et il faut que la MÊME décision se lise dans `distinct` : un
        // `count(DISTINCT ...)` ignorerait les nuls et annoncerait une valeur de moins que
        // celles que la liste rend juste à côté.
        let dir = tempfile::tempdir().unwrap();
        let chemin = dir.path().join("mirror.sqlite");
        let c = rusqlite::Connection::open(&chemin).unwrap();
        c.execute_batch(
            "CREATE TABLE _meta(cle TEXT, valeur TEXT);
             INSERT INTO _meta VALUES ('source', 'pg:DATABASE_URL');
             CREATE TABLE inagle_creux(id TEXT, groupe TEXT);
             INSERT INTO inagle_creux VALUES ('a', 'plein');
             INSERT INTO inagle_creux VALUES ('b', '');
             INSERT INTO inagle_creux VALUES ('c', NULL);",
        )
        .unwrap();
        drop(c);
        let g = crate::dataset::Gisement::nouveau(&chemin);
        let t = table_de(&g, "inagle_creux");

        let f = faceter(&g, &t, &analyser(&t, &q(&[("facets", "groupe")])).unwrap());
        assert_eq!(f[0].distinct, 2, "`plein` et le creux, pas trois groupes");
        assert_eq!(
            f[0].values.len(),
            2,
            "`distinct` et la liste comptent pareil"
        );
        assert_eq!(compte_de(&f[0], "plein"), Some(1));
        let creux = f[0]
            .values
            .iter()
            .find(|v| v.value.is_none())
            .expect("le creux est une valeur, rendue `null`");
        assert_eq!(
            creux.count, 2,
            "la chaine vide et le NULL comptent ensemble"
        );
    }

    #[test]
    fn une_borne_retient_un_intervalle_et_ses_deux_bords() {
        // La moitie positive seule ne prouverait rien : une clause qui ne filtrerait pas
        // rendrait 3 aux quatre appels. Les bords sont testes parce que `>=`/`<=` sont un
        // choix — un intervalle exclusif serait une autre reponse, et il faut qu'elle rougisse.
        let (_d, g) = base();
        let t = table_de(&g, "inagle_characters");
        let cas = [
            (vec![("zukan__min", "2")], 2),
            (vec![("zukan__max", "2")], 2),
            (vec![("zukan__min", "2"), ("zukan__max", "2")], 1),
            (vec![("zukan__min", "9")], 0),
        ];
        for (params, attendu) in cas {
            let d = analyser(&t, &q(&params)).unwrap();
            assert_eq!(compter(&g, &t, &d), attendu, "pour {params:?}");
        }
    }

    #[test]
    fn une_borne_sur_une_colonne_texte_est_refusee_pas_approximee() {
        // C'est le coeur de la regle : SQLite comparerait volontiers `'Mark' >= '400'` et
        // rendrait une page plausible. Un 400 dit ce qui ne peut pas etre demande.
        let (_d, g) = base();
        let t = table_de(&g, "inagle_characters");
        let e = analyser(&t, &q(&[("name_fr__min", "400")])).unwrap_err();
        assert!(matches!(e, ErreurSite::Demande(_)));
        // Et la meme borne sur la colonne numerique passe : sans cette moitie, un refus
        // universel passerait aussi le test.
        assert!(analyser(&t, &q(&[("zukan__min", "400")])).is_ok());
    }

    #[test]
    fn une_borne_non_numerique_et_une_colonne_inconnue_sont_deux_400_distincts() {
        let (_d, g) = base();
        let t = table_de(&g, "inagle_characters");
        for cle in ["zukan__min", "zukan__max"] {
            assert!(analyser(&t, &q(&[(cle, "beaucoup")])).is_err());
        }
        assert!(analyser(&t, &q(&[("absente__min", "1")])).is_err());
    }

    #[test]
    fn la_presence_separe_le_renseigne_du_vide_et_du_nul() {
        // Le miroir melange NULL et chaine vide ; le test le reproduit exactement, sinon il
        // testerait une base plus propre que la vraie.
        let (dir, g) = base();
        // L'ecriture passe par une connexion a part : le gisement est ouvert en LECTURE SEULE,
        // et un `execute_batch` a travers lui echouerait — silencieusement si on l'ignorait.
        let ecriture = Connection::open(dir.path().join("mirror.sqlite")).unwrap();
        ecriture
            .execute_batch(
                "INSERT INTO inagle_characters VALUES ('c4', NULL, 'Feu', 4);
                 INSERT INTO inagle_characters VALUES ('c5', '', 'Feu', 5);",
            )
            .unwrap();
        drop(ecriture);
        let t = table_de(&g, "inagle_characters");
        let present = analyser(&t, &q(&[("name_fr", JETON_PRESENT)])).unwrap();
        let absent = analyser(&t, &q(&[("name_fr", JETON_ABSENT)])).unwrap();
        let total = analyser(&t, &q(&[])).unwrap();
        let (p, a, n) = (
            compter(&g, &t, &present),
            compter(&g, &t, &absent),
            compter(&g, &t, &total),
        );
        assert_eq!(p + a, n, "les deux moities doivent partitionner la table");
        assert!(p > 0 && p < n, "un filtre qui ne retient ni tout ni rien");
    }

    #[test]
    fn les_trois_formes_sont_republiees_telles_qu_appliquees() {
        // La lecon du lot 8 : appliquer sans avouer est le meme aveuglement que ne pas
        // appliquer, vu du client.
        let (_d, g) = base();
        let t = table_de(&g, "inagle_characters");
        let d = analyser(
            &t,
            &q(&[
                ("element", "Feu"),
                ("zukan__min", "2"),
                ("name_fr", JETON_PRESENT),
            ]),
        )
        .unwrap();
        let f = d.appliques();
        assert_eq!(f.egalites.get("element").map(String::as_str), Some("Feu"));
        assert_eq!(f.bornes.get("zukan__min"), Some(&2.0));
        assert_eq!(f.presences.get("name_fr"), Some(&"present"));
    }

    /// Un second gisement, avec les tables de la série — noms disjoints de `inagle_*`.
    fn base_anime() -> (tempfile::TempDir, crate::dataset::Gisement) {
        let dir = tempfile::tempdir().unwrap();
        let chemin = dir.path().join("episodes.db");
        let c = Connection::open(&chemin).unwrap();
        c.execute_batch(
            "CREATE TABLE episodes(id INTEGER PRIMARY KEY, season INTEGER, title TEXT);
             INSERT INTO episodes VALUES (1, 1, 'Le premier match');
             INSERT INTO episodes VALUES (2, 3, 'La revanche');
             CREATE TABLE seasons(id INTEGER PRIMARY KEY, nom TEXT);
             INSERT INTO seasons VALUES (1, 'Saison 1');",
        )
        .unwrap();
        drop(c);
        let g = crate::dataset::Gisement::nouveau(&chemin);
        (dir, g)
    }

    /// Un gisement qui ne pointe sur rien — l'état d'un miroir qui n'a pas encore tourné.
    fn base_absente() -> crate::dataset::Gisement {
        crate::dataset::Gisement::nouveau("/inexistant/aucun-gisement.sqlite")
    }

    #[test]
    fn une_cellule_csv_est_echappee_selon_rfc_4180() {
        // Moitie positive ET negative : sans la seconde, un echappement universel passerait,
        // et le fichier serait plein de guillemets inutiles.
        assert_eq!(echapper_csv("Mark"), "Mark");
        assert_eq!(echapper_csv("Feu, Vent"), "\"Feu, Vent\"");
        assert_eq!(echapper_csv("il dit \"non\""), "\"il dit \"\"non\"\"\"");
        assert_eq!(echapper_csv("deux\nlignes"), "\"deux\nlignes\"");
    }

    #[test]
    fn les_colonnes_csv_sont_l_union_pas_celles_de_la_premiere_ligne() {
        // Une ligne du miroir peut omettre une colonne nulle. Prendre les cles de la premiere
        // ligne perdrait la colonne suivante en silence — et un CSV ampute ne se voit pas.
        let mut a = MapJson::new();
        a.insert("id".into(), ValeurJson::String("c1".into()));
        let mut b = MapJson::new();
        b.insert("id".into(), ValeurJson::String("c2".into()));
        b.insert("element".into(), ValeurJson::String("Feu".into()));
        let page = PageLignes {
            page: Page::nouvelle(vec![a, b], Pagination::borner(None, None), 2),
            gisement: GISEMENT_EXTRAIT,
            table: "inagle_characters".to_owned(),
            cle: "id".to_owned(),
            filtres: FiltresAppliques {
                q: None,
                tri: "id".to_owned(),
                ordre: "asc",
                egalites: BTreeMap::new(),
                listes: BTreeMap::new(),
                bornes: BTreeMap::new(),
                presences: BTreeMap::new(),
            },
            facets: Vec::new(),
        };
        let corps = reponse_csv(&page);
        assert_eq!(corps.status(), axum::http::StatusCode::OK);
        let nom = corps
            .headers()
            .get(axum::http::header::CONTENT_DISPOSITION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        assert!(
            nom.contains("inagle_characters-page1.csv"),
            "le nom porte la table ET la page, sinon deux exports se recouvrent : {nom}"
        );
    }

    #[test]
    fn un_format_inconnu_est_refuse_pas_rendu_en_json() {
        // Rendre du JSON « par defaut » ferait telecharger un fichier au mauvais format sans
        // un mot. La liste servie tient en deux entrees, et elle est close.
        assert_eq!(FORMATS, ["json", "csv"]);
        assert!(PARAMS_RESERVES.contains(&"format"));
    }

    #[test]
    fn une_table_se_lit_dans_le_gisement_qui_la_porte() {
        let (_d, miroir) = base();
        let (_d2, anime) = base_anime();
        // La moitie positive de chaque cote : chacun trouve SA table.
        let a =
            dans_le_gisement(&miroir, &anime, "inagle_characters", |_, t| Ok(t.gisement)).unwrap();
        let b = dans_le_gisement(&miroir, &anime, "episodes", |_, t| Ok(t.gisement)).unwrap();
        assert_eq!(a, GISEMENT_EXTRAIT);
        assert_eq!(b, GISEMENT_ANIME);
        // Et la negative : un nom qu'aucun des deux ne porte est un 404, pas un 503.
        let e = dans_le_gisement(&miroir, &anime, "inagle_absente", |_, _| Ok(())).unwrap_err();
        assert!(matches!(e, ErreurSite::Introuvable(_)));
    }

    #[test]
    fn un_gisement_absent_degrade_au_lieu_d_eteindre() {
        // La regle du demarrage, tenue ici : le miroir manque, la serie repond quand meme.
        let (_d2, anime) = base_anime();
        let v = dans_le_gisement(&base_absente(), &anime, "episodes", |_, t| {
            Ok(t.nom.clone())
        });
        assert_eq!(v.unwrap(), "episodes");
    }

    #[test]
    fn aucun_gisement_monte_est_un_503_pas_un_404() {
        // Le distinguo compte : un 404 ferait corriger son URL a un client qui devrait
        // simplement attendre que le miroir tourne.
        let e = dans_le_gisement(&base_absente(), &base_absente(), "episodes", |_, _| Ok(()))
            .unwrap_err();
        assert!(
            matches!(e, ErreurSite::Indisponible(_)),
            "sans gisement monte, la route est indisponible, pas introuvable"
        );
    }

    #[test]
    fn une_erreur_de_la_table_trouvee_n_est_pas_un_404() {
        // Le defaut mesure le 2026-09-06 : `tri=` sur une colonne inconnue d'une table du
        // SECOND gisement ressortait en 404 « aucune table ne se nomme `episodes` », parce que
        // la boucle continuait apres l'echec de `f`. Un message qui envoie corriger un nom de
        // table juste est pire qu'une erreur brute.
        let (_d, miroir) = base();
        let (_d2, anime) = base_anime();
        let e = dans_le_gisement(&miroir, &anime, "episodes", |_, t| {
            analyser(t, &q(&[("tri", "pertinence")])).map(|_| ())
        })
        .unwrap_err();
        assert!(
            matches!(e, ErreurSite::Demande(_)),
            "un tri sur une colonne inconnue est un 400, pas un 404 : {e:?}"
        );
    }

    #[test]
    fn les_filtres_generiques_marchent_aussi_sur_la_serie() {
        // Le gain reel de ce lot : les quatre filtres des episodes (#37-40 de docs/FILTRES.md)
        // ne sont pas quatre lignes de code, ce sont ZERO — ils viennent avec la route.
        let (_d, anime) = base_anime();
        let n = dans_le_gisement(&base_absente(), &anime, "episodes", |c, t| {
            let d = analyser(t, &q(&[("season", "3")]))?;
            Ok(i64::try_from(page_lignes(c, t, &d)?.total).unwrap_or(i64::MAX))
        })
        .unwrap();
        assert_eq!(n, 1, "une seule saison 3 sur les deux episodes");
    }

    #[test]
    fn le_catalogue_est_mesure_et_exclut_la_plomberie() {
        let (_d, g) = base();
        let cat = g.lire(catalogue_compte).unwrap();
        let noms: Vec<&str> = cat.iter().map(|t| t.table.nom.as_str()).collect();
        assert_eq!(
            noms,
            [
                "inagle_characters",
                "inagle_exp_table",
                "inagle_liens",
                "inagle_skills"
            ],
            "`_meta` n'est pas servie"
        );
        let chara = &cat[0];
        assert_eq!(chara.lignes, 3);
        assert_eq!(chara.table.cle, "id");
        assert!(!chara.table.cle_implicite);
        assert_eq!(chara.table.colonnes.len(), 4);
        // La clé primaire déclarée l'emporte, et une table sans rien retombe sur `rowid`.
        let skills = cat.iter().find(|t| t.table.nom == "inagle_skills").unwrap();
        assert_eq!(skills.table.cle, "code");
        let liens = cat.iter().find(|t| t.table.nom == "inagle_liens").unwrap();
        assert_eq!(liens.table.cle, "rowid");
        assert!(liens.table.cle_implicite);
    }

    #[test]
    fn une_table_inconnue_est_un_404_et_n_execute_rien() {
        let (_d, g) = base();
        let cat = g.lire(schema).unwrap();
        for tentative in [
            "table_qui_n_existe_pas",
            "inagle_characters; DROP TABLE inagle_characters",
            "sqlite_master",
            "_meta",
            "\"inagle_characters\"",
            "inagle_characters--",
        ] {
            let e = trouver(&cat, tentative).unwrap_err();
            assert_eq!(e.statut().as_u16(), 404, "`{tentative}` doit etre refusee");
        }
        // Preuve par falsification : la base est intacte, donc rien n'a été exécuté.
        assert_eq!(
            g.compte_table("inagle_characters").unwrap(),
            Some(3),
            "aucune tentative n'a touche la base"
        );
    }

    #[test]
    fn une_colonne_fabriquee_est_un_400_et_n_entre_pas_dans_le_sql() {
        let (_d, g) = base();
        let cat = g.lire(schema).unwrap();
        let t = trouver(&cat, "inagle_characters").unwrap();
        for (cle, valeur) in [
            ("colonne_inventee", "x"),
            ("id\" OR 1=1 --", "x"),
            ("name_fr; DROP TABLE inagle_characters", "x"),
        ] {
            let e = analyser(t, &q(&[(cle, valeur)])).unwrap_err();
            assert_eq!(e.statut().as_u16(), 400, "`{cle}` doit etre refusee");
        }
        for tri in ["colonne_inventee", "id\" DESC --", "(SELECT 1)"] {
            let e = analyser(t, &q(&[("tri", tri)])).unwrap_err();
            assert_eq!(e.statut().as_u16(), 400, "`tri={tri}` doit etre refuse");
        }
        assert_eq!(g.compte_table("inagle_characters").unwrap(), Some(3));
    }

    #[test]
    fn le_filtre_d_egalite_est_honore() {
        let (_d, g) = base();
        let cat = g.lire(schema).unwrap();
        let t = trouver(&cat, "inagle_characters").unwrap();
        let d = analyser(t, &q(&[("element", "Feu")])).unwrap();
        assert_eq!(d.egalites, vec![("element".to_owned(), "Feu".to_owned())]);
        let page = g.lire(|c| page_lignes(c, t, &d)).unwrap();
        assert_eq!(page.total, 2, "deux personnages de Feu, pas trois");
        assert!(page.elements.iter().all(|l| l["element"] == "Feu"));
        // Falsification : sans le filtre, le total remonte à 3.
        let sans = analyser(t, &q(&[])).unwrap();
        assert_eq!(g.lire(|c| page_lignes(c, t, &sans)).unwrap().total, 3);
    }

    #[test]
    fn q_cherche_vraiment_sur_les_colonnes_texte() {
        let (_d, g) = base();
        let cat = g.lire(schema).unwrap();
        let t = trouver(&cat, "inagle_characters").unwrap();
        let d = analyser(t, &q(&[("q", "mar")])).unwrap();
        let page = g.lire(|c| page_lignes(c, t, &d)).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.elements[0]["name_fr"], "Mark");
        // Un motif absent ne rend rien — sans quoi `q` serait un paramètre décoratif.
        let vide = analyser(t, &q(&[("q", "zzzz")])).unwrap();
        assert_eq!(g.lire(|c| page_lignes(c, t, &vide)).unwrap().total, 0);
        // Le joker du client est échappé : `%` est un pourcent, pas « tout ».
        let joker = analyser(t, &q(&[("q", "%")])).unwrap();
        assert_eq!(g.lire(|c| page_lignes(c, t, &joker)).unwrap().total, 0);
    }

    #[test]
    fn q_sur_une_table_sans_colonne_texte_est_un_400_franc() {
        let (_d, g) = base();
        let cat = g.lire(schema).unwrap();
        let t = trouver(&cat, "inagle_exp_table").unwrap();
        assert!(t.colonnes_texte().is_empty());
        let e = analyser(t, &q(&[("q", "1")])).unwrap_err();
        assert_eq!(e.statut().as_u16(), 400);
        assert!(format!("{e}").contains("colonne texte"), "{e}");
        // Sans `q`, la même table se lit parfaitement.
        assert!(analyser(t, &q(&[])).is_ok());
    }

    #[test]
    fn le_tri_et_l_ordre_sont_honores_ou_refuses() {
        let (_d, g) = base();
        let cat = g.lire(schema).unwrap();
        let t = trouver(&cat, "inagle_characters").unwrap();
        let noms = |d: &Demande| -> Vec<String> {
            g.lire(|c| page_lignes(c, t, d))
                .unwrap()
                .elements
                .iter()
                .map(|l| l["name_fr"].as_str().unwrap().to_owned())
                .collect()
        };
        let asc = analyser(t, &q(&[("tri", "name_fr")])).unwrap();
        assert_eq!(noms(&asc), ["Axel", "Jude", "Mark"]);
        let desc = analyser(t, &q(&[("tri", "name_fr"), ("ordre", "desc")])).unwrap();
        assert_eq!(noms(&desc), ["Mark", "Jude", "Axel"]);
        assert_eq!(desc.appliques().ordre, "desc");

        let e = analyser(t, &q(&[("ordre", "aleatoire")])).unwrap_err();
        assert_eq!(e.statut().as_u16(), 400);
    }

    #[test]
    fn la_pagination_est_bornee_et_le_non_numerique_refuse() {
        let (_d, g) = base();
        let cat = g.lire(schema).unwrap();
        let t = trouver(&cat, "inagle_characters").unwrap();
        let d = analyser(t, &q(&[("page", "2"), ("par_page", "1")])).unwrap();
        let page = g.lire(|c| page_lignes(c, t, &d)).unwrap();
        assert_eq!(page.elements.len(), 1);
        assert_eq!(page.total, 3);
        assert_eq!(page.pages, 3);
        assert_eq!(page.elements[0]["id"], "c2");
        // Le plafond dur s'applique, quoi que le client demande.
        let enorme = analyser(t, &q(&[("par_page", "100000")])).unwrap();
        assert_eq!(enorme.pagination.per_page, crate::config::PER_PAGE_MAX);
        // `per_page` reste accepté, comme partout ailleurs dans l'API.
        assert_eq!(
            analyser(t, &q(&[("per_page", "7")]))
                .unwrap()
                .pagination
                .per_page,
            7
        );
        let e = analyser(t, &q(&[("page", "deux")])).unwrap_err();
        assert_eq!(e.statut().as_u16(), 400);
    }

    #[test]
    fn un_filtre_a_valeur_vide_est_refuse_plutot_que_devine() {
        let (_d, g) = base();
        let cat = g.lire(schema).unwrap();
        let t = trouver(&cat, "inagle_characters").unwrap();
        let e = analyser(t, &q(&[("element", "")])).unwrap_err();
        assert_eq!(e.statut().as_u16(), 400);
    }

    #[test]
    fn une_ligne_se_lit_par_sa_cle_et_par_son_rowid() {
        let (_d, g) = base();
        let cat = g.lire(schema).unwrap();
        let chara = trouver(&cat, "inagle_characters").unwrap();
        let l = g.lire(|c| lire_ligne(c, chara, "c2")).unwrap();
        assert_eq!(l["name_fr"], "Axel");
        let e = g.lire(|c| lire_ligne(c, chara, "c999")).unwrap_err();
        assert_eq!(e.statut().as_u16(), 404);

        let liens = trouver(&cat, "inagle_liens").unwrap();
        let l = g.lire(|c| lire_ligne(c, liens, "1")).unwrap();
        assert_eq!(l["source"], "a");
        assert_eq!(l["rowid"], 1);
        let e = g
            .lire(|c| lire_ligne(c, liens, "pas_un_entier"))
            .unwrap_err();
        assert_eq!(e.statut().as_u16(), 404);
    }

    #[test]
    fn sans_miroir_les_lectures_sont_indisponibles() {
        let g = crate::dataset::Gisement::nouveau("/nonexistent/mirror.sqlite");
        assert_eq!(g.lire(schema).unwrap_err().statut().as_u16(), 503);
        assert_eq!(g.lire(catalogue_compte).unwrap_err().statut().as_u16(), 503);
    }

    #[test]
    fn la_garde_de_forme_refuse_ce_qui_n_est_pas_un_identifiant() {
        assert!(nom_sql_valide("inagle_characters"));
        assert!(nom_sql_valide("_meta"));
        assert!(!nom_sql_valide(""));
        assert!(!nom_sql_valide("a b"));
        assert!(!nom_sql_valide("a\"b"));
        assert!(!nom_sql_valide("a;b"));
        assert!(!nom_sql_valide("1table"));
        assert!(!nom_sql_valide(&"x".repeat(NOM_MAX + 1)));
    }

    /// Sert les trois routes sur `127.0.0.1:8099`, contre le **vrai** miroir du dépôt, le temps
    /// de les interroger au `curl`.
    ///
    /// `#[ignore]` : elle a besoin de `var/mirror.sqlite` et d'un port libre, deux choses qu'une
    /// suite ne doit pas exiger. Elle existe parce qu'un test qui appelle le handler ne prouve
    /// pas le routeur — le dépôt l'a déjà payé (`/en/manifest.webmanifest` rendait du HTML
    /// pendant que son test unitaire était vert). Ici le montage reste **local** : câbler ces
    /// routes dans `app::routeur` n'est pas du ressort de ce module.
    ///
    /// ```text
    /// cargo test -p nie-site --lib -- --ignored --nocapture sert_en_reel
    /// ```
    ///
    /// La durée se règle par `NIE_SITE_ESSAI_SECONDES` (60 par défaut) : bornée, pour qu'un
    /// oubli ne laisse pas un port pris.
    #[tokio::test]
    #[ignore = "exige var/mirror.sqlite et le port 8099"]
    async fn sert_en_reel_sur_8099() {
        use std::future::IntoFuture as _;

        let racine = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .unwrap()
            .to_path_buf();
        let config = crate::config::Config {
            db: racine.join("var/mirror.sqlite"),
            ..crate::config::Config::default()
        };
        assert!(
            config.db.is_file(),
            "miroir absent: {}",
            config.db.display()
        );
        let etat = EtatSite::nouveau(config);
        let app = axum::Router::new()
            .route("/api/v1/entites", axum::routing::get(catalogue))
            .route("/api/v1/entites/{table}", axum::routing::get(lignes))
            .route("/api/v1/entites/{table}/{id}", axum::routing::get(ligne))
            .with_state(etat);
        let ecoute = tokio::net::TcpListener::bind("127.0.0.1:8099")
            .await
            .unwrap();
        let secondes = std::env::var("NIE_SITE_ESSAI_SECONDES")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(60);
        println!("essai en ecoute sur 127.0.0.1:8099 pendant {secondes} s");
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(secondes),
            axum::serve(ecoute, app).into_future(),
        )
        .await;
    }

    #[test]
    fn l_affinite_texte_suit_la_regle_de_sqlite() {
        assert!(colonne_texte("TEXT"));
        assert!(colonne_texte("varchar(50)"));
        assert!(colonne_texte("NATIVE CHARACTER"));
        assert!(colonne_texte("CLOB"));
        assert!(!colonne_texte("INTEGER"));
        assert!(!colonne_texte("REAL"));
        assert!(!colonne_texte(""), "un type absent a l'affinite BLOB");
    }
}
