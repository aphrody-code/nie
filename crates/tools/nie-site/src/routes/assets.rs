//! `/assets/*` — proxy durci vers `nie-model-serve` (`127.0.0.1:8790`).
//!
//! Le décodage (G4TX → PNG, ACB → WAV, assemblage GLB) reste chez `nie-model-serve` : cette
//! crate ne réimplémente rien. Elle en fait en revanche un amont **borné**, ce qu'il n'est pas
//! par lui-même :
//!
//! - concurrence plafonnée (`tower::limit` côté couche, sémaphore côté requête) : un pic de
//!   trafic ne s'y transforme pas en effondrement ;
//! - délai maximal de 10 s, appliqué par le client — un amont qui accepte la connexion sans
//!   jamais répondre (cas observé le 2026-09-05) rend un `504`, pas une connexion pendante ;
//! - taille de réponse **bornée** : au-delà, la réponse est refusée plutôt que bufferisée ;
//! - cache `moka` par clé canonique, ETag `blake3`, `304` sur `If-None-Match`.
//!
//! ## Audit Azalée CPK/images (2026-09-09)
//!
//! Les règles portables sont désormais dans les owners Rust :
//!
//! - `nie_formats::asset` classe les entrées CPK par famille et par preview ;
//! - `nie_formats::cri_audio` classe les banques et extrait les codes voix ;
//! - `nie_core::azalee::asset_mapping` transforme les codes d'aura et de modèle sans connaître
//!   de transport ;
//! - ce module construit les chemins publics `/assets/*`, en réutilisant les mêmes routes que
//!   `nie-model-serve` et `routes::inspect`.
//!
//! Ne sont pas des règles IEVR à recopier dans Rust : le fetch `fetch`/React et l'arbre lazy de
//! `packages/azalee/src/cpk/live.ts` sont des comportements de client ; les manifests de présence
//! (`item-image`, `menu-asset`, modèles et Miximax) sont des résultats générés depuis un VFS ou
//! une sonde HTTP ; `getOptimizedImageUrl` est le protocole privé de Next.js ; enfin les variantes
//! `?w=&format=webp` appartiennent à `cdn-variants` et le miroir Zukan 360° est absent. Les
//! manifests restent donc des données d'entrée du host, et ces services externes ne sont pas
//! déguisés en capacité native inventée.

use axum::extract::{Path, RawQuery, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};

use crate::error::ErreurSite;
use crate::routes::static_files::{Encodage, etiquette, reponse_octets};
use crate::state::{EtatSite, ReponseCachee};

/// `Cache-Control` des rendus d'amont : le décodage d'un chemin donné est déterministe, mais
/// le décodeur évolue — une heure de fraîcheur, une journée de service dégradé toléré.
pub const CONTROLE: &str = "public, max-age=3600, stale-while-revalidate=86400";

/// URL publique d'un atlas ou d'une texture G4TX via le proxy du site.
///
/// Le nom de texture conserve `.g4tx` dans le chemin : c'est ce segment qui permet à l'amont de
/// sélectionner une texture nommée. Sans nom, le suffixe est retiré pour adresser l'atlas et le
/// préfixe VFS `data/` est retiré uniquement dans ce cas. Un chemin sans suffixe conserve son
/// préfixe, comme la route d'inspection historique. `path` doit déjà être un chemin VFS validé par
/// [`crate::routes::vfs::normaliser`].
#[must_use]
pub fn texture_url(path: &str, texture_name: Option<&str>) -> String {
    match texture_name {
        Some(name) => format!("/assets/tex/{path}/{name}.png"),
        None => {
            let atlas = if nie_formats::asset::extension(path)
                .is_some_and(|ext| ext.eq_ignore_ascii_case("g4tx"))
            {
                nie_formats::asset::texture_route_stem(path)
            } else {
                path.to_owned()
            };
            format!("/assets/tex/{atlas}.png")
        }
    }
}

/// URL publique des octets bruts décompressés d'un fichier VFS.
#[must_use]
pub fn raw_url(path: &str) -> String {
    format!("/assets/raw/{path}")
}

/// URL publique d'un fichier de configuration décodé en JSON.
#[must_use]
pub fn config_url(path: &str) -> String {
    format!("/assets/cfg/{path}.json")
}

/// URL publique d'une banque ou d'un flux audio décodé en WAV.
#[must_use]
pub fn audio_url(path: &str, awb_id: Option<u16>) -> String {
    match awb_id {
        Some(id) => format!("/assets/audio/{path}?id={id}"),
        None => format!("/assets/audio/{path}"),
    }
}

/// URL publique d'une cinématique décodée.
#[must_use]
pub fn video_url(path: &str) -> String {
    format!("/assets/video/{path}")
}

/// URL publique de l'export d'une ressource ou d'une sous-entrée de conteneur.
#[must_use]
pub fn export_url(path: &str, format: &str, id: Option<u16>) -> String {
    let separator = if id.is_some() { "&" } else { "" };
    let id = id.map_or_else(String::new, |value| format!("{separator}id={value}"));
    format!("/assets/export/{path}?format={format}{id}")
}

/// URL publique correspondant au mapping de `cpkAssetUrl`.
///
/// Le mapping est intentionnellement conservateur sur le type : une entrée `.g4md`/`.g4mg`
/// produit un chemin d'assembleur, mais l'amont peut encore répondre `404` si la paire de
/// composants n'est pas assemblable. La présence ne peut être affirmée qu'après lecture de
/// l'index VFS et, pour les personnages, des catalogues de l'assembleur.
#[must_use]
pub fn cpk_asset_url(path: &str, ext: Option<&str>) -> Option<String> {
    let extension = ext.or_else(|| nie_formats::asset::extension(path))?;
    match nie_formats::asset::cpk_asset_kind(extension) {
        nie_formats::asset::CpkAssetKind::Image => Some(texture_url(path, None)),
        nie_formats::asset::CpkAssetKind::Model => {
            let name = path.rsplit('/').next().unwrap_or(path);
            let stem = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
            Some(format!("/assets/model-full/{stem}.glb"))
        }
        nie_formats::asset::CpkAssetKind::Raw => Some(raw_url(path)),
    }
}

/// `GET /assets/{*chemin}` — le fichier du bundle s'il existe, l'amont sinon.
///
/// Les deux cohabitent sous le même préfixe parce que Vite écrit ses fichiers empreintés dans
/// `dist/assets/` : servir le bundle d'abord évite de renommer quoi que ce soit côté
/// `apps/nie-web`, et un chemin de bundle ne peut pas être un chemin d'amont (il porte une
/// empreinte, l'autre un chemin VFS).
pub async fn assets(
    State(etat): State<EtatSite>,
    Path(chemin): Path<String>,
    query: RawQuery,
    entetes: HeaderMap,
) -> Response {
    let relatif = format!("assets/{}", chemin.trim_start_matches('/'));
    if let Some(r) = crate::routes::static_files::servir(&etat, &relatif, &entetes).await {
        return r;
    }
    match proxy(State(etat), Path(chemin), query, entetes).await {
        Ok(r) => r,
        Err(e) => e.into_response(),
    }
}

/// Relaie vers l'amont, avec cache et ETag.
///
/// # Errors
///
/// `Demande` sur chemin invalide, `Delai` quand l'amont ne répond pas dans le délai imparti,
/// `Amont` quand il répond mal ou trop gros, `Introuvable` quand il rend 404.
pub async fn proxy(
    State(etat): State<EtatSite>,
    Path(chemin): Path<String>,
    RawQuery(query): RawQuery,
    entetes: HeaderMap,
) -> Result<Response, ErreurSite> {
    let chemin = crate::routes::vfs::normaliser(&chemin)?;
    let query = query.filter(|q| !q.is_empty());
    let cle = match &query {
        Some(q) => format!("amont:{chemin}?{q}"),
        None => format!("amont:{chemin}"),
    };

    if let Some(cachee) = etat.cache.get(&cle).await {
        return Ok(reponse_octets(
            &cachee,
            CONTROLE,
            Encodage::Identite,
            &entetes,
        ));
    }

    let url = match &query {
        Some(q) => format!("{}/{chemin}?{q}", etat.config.amont),
        None => format!("{}/{chemin}", etat.config.amont),
    };

    // Le sémaphore borne le nombre d'appels simultanés à l'amont. Il est acquis AVANT la
    // requête et relâché à la fin de la fonction : un amont lent fait attendre, il n'écroule pas.
    let _jeton = etat
        .jetons_amont
        .acquire()
        .await
        .map_err(|_| ErreurSite::Interne("limiteur d'amont ferme".to_owned()))?;

    let reponse = etat.client.get(&url).send().await.map_err(|e| {
        // L'ordre des deux tests est le correctif : un echec de CONNEXION passe avant le
        // delai, car `connect_timeout` (2 s) rend une erreur qui est A LA FOIS `is_connect`
        // et `is_timeout`. Teste dans l'autre sens, elle devenait un `504` annoncant « pas
        // repondu en 10s » — un message faux (le delai ecoule est 2 s, pas 10) sur un amont
        // qui n'a jamais accepte la connexion. Mesure du 2026-09-06 sur le poste Windows :
        // vers `127.0.0.1:1`, l'OS met ~2,03 s a rendre `ConnectionRefused` (10061) la ou
        // Linux le rend immediatement — la course avec `connect_timeout(2 s)` faisait donc
        // basculer le meme scenario entre 502 et 504 selon la plateforme et selon le jour.
        // Un amont qu'on n'atteint pas est une PASSERELLE en defaut (502) ; le 504 reste
        // reserve a un amont qui a accepte la connexion puis n'a pas repondu a temps.
        if e.is_connect() {
            tracing::warn!(erreur = %e, url = %url, "amont injoignable");
            ErreurSite::Amont("nie-model-serve injoignable".to_owned())
        } else if e.is_timeout() {
            ErreurSite::Delai(format!(
                "nie-model-serve n'a pas repondu en {}s",
                etat.config.delai_amont.as_secs()
            ))
        } else {
            tracing::warn!(erreur = %e, url = %url, "amont injoignable");
            ErreurSite::Amont("nie-model-serve injoignable".to_owned())
        }
    })?;

    let statut = reponse.status();
    if statut == reqwest::StatusCode::NOT_FOUND {
        return Err(ErreurSite::Introuvable(format!(
            "asset inconnu de l'amont: {chemin}"
        )));
    }
    if !statut.is_success() {
        return Err(ErreurSite::Amont(format!(
            "nie-model-serve a repondu {}",
            statut.as_u16()
        )));
    }

    // Une réponse annoncée trop grosse est refusée avant même d'être lue.
    if let Some(taille) = reponse.content_length()
        && taille > etat.config.taille_max_amont as u64
    {
        return Err(ErreurSite::Amont(format!(
            "reponse d'amont trop grosse ({taille} octets, plafond {})",
            etat.config.taille_max_amont
        )));
    }

    let type_contenu = reponse
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();

    let corps = reponse.bytes().await.map_err(|e| {
        if e.is_timeout() {
            ErreurSite::Delai("corps d'amont tronque par le delai".to_owned())
        } else {
            ErreurSite::Amont("corps d'amont illisible".to_owned())
        }
    })?;
    // Ceinture ET bretelles : un amont peut mentir sur `Content-Length` (ou n'en donner aucun).
    if corps.len() > etat.config.taille_max_amont {
        return Err(ErreurSite::Amont(format!(
            "reponse d'amont trop grosse ({} octets)",
            corps.len()
        )));
    }

    let cachee = ReponseCachee {
        etag: etiquette(&corps),
        type_contenu,
        corps,
    };
    etat.cache.insert(cle, cachee.clone()).await;
    Ok(reponse_octets(
        &cachee,
        CONTROLE,
        Encodage::Identite,
        &entetes,
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        audio_url, config_url, cpk_asset_url, export_url, raw_url, texture_url, video_url,
    };

    #[test]
    fn construit_les_routes_de_contenu_avec_le_meme_contrat_que_l_amont() {
        assert_eq!(
            texture_url("data/dx11/menu/icon.g4tx", None),
            "/assets/tex/dx11/menu/icon.png"
        );
        assert_eq!(
            texture_url("data/dx11/menu/icon.g4tx", Some("face_1")),
            "/assets/tex/data/dx11/menu/icon.g4tx/face_1.png"
        );
        assert_eq!(
            raw_url("data/common/file.bin"),
            "/assets/raw/data/common/file.bin"
        );
        assert_eq!(
            config_url("data/common/config.cfg.bin"),
            "/assets/cfg/data/common/config.cfg.bin.json"
        );
        assert_eq!(
            audio_url("data/common/sound_asset/bgm.acb", Some(42)),
            "/assets/audio/data/common/sound_asset/bgm.acb?id=42"
        );
        assert_eq!(
            video_url("data/movie/opening.usm"),
            "/assets/video/data/movie/opening.usm"
        );
        assert_eq!(
            export_url("data/dx11/icon.g4tx", "png", Some(3)),
            "/assets/export/data/dx11/icon.g4tx?format=png&id=3"
        );
    }

    #[test]
    fn mappe_les_familles_cpk_sans_affirmer_leur_presence() {
        assert_eq!(
            cpk_asset_url("data/dx11/menu/icon.g4tx", None).as_deref(),
            Some("/assets/tex/dx11/menu/icon.png")
        );
        assert_eq!(
            cpk_asset_url("data/common/chr/c01000010.g4md", None).as_deref(),
            Some("/assets/model-full/c01000010.glb")
        );
        assert_eq!(
            cpk_asset_url("data/common/file.bin", Some("bin")).as_deref(),
            Some("/assets/raw/data/common/file.bin")
        );
        assert_eq!(cpk_asset_url("data/common/file", None), None);
    }
}
