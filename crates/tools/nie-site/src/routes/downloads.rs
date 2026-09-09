//! `/downloads/inacord/latest.json` — le manifeste de mise à jour d'Inacord.
//!
//! `apps/inacord/src-tauri/tauri.conf.json` points first to this endpoint and then to the GitHub
//! release fallback. The endpoint serves the latest signed Windows installer manifest.
//!
//! ## Ce que la route fait, et ne fait pas
//!
//! Elle interroge l'API GitHub Releases, retient la dernière release publiée (ni brouillon ni
//! préversion) qui porte un installeur NSIS **signé**, lit le fichier `.sig` et rend le
//! manifeste au format qu'attend le plugin updater de Tauri v2. Elle n'écrit rien sur disque et
//! ne connaît aucun secret : le dépôt est public, l'API anonyme suffit.
//!
//! La borne de 60 requêtes par heure et par IP de l'API anonyme est tenue par le cache partagé
//! de la crate (`EtatSite::cache`, cinq minutes) : douze appels par heure au pire, pour un
//! plafond de soixante. Y mettre un jeton aurait échangé cette marge contre un secret dans un
//! service qui n'en porte aucun.

use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use serde::Serialize;

use crate::error::ErreurSite;
use crate::state::{EtatSite, ReponseCachee};

/// Le dépôt qui publie Inacord.
const DEPOT: &str = "aphrody-code/nie";

/// L'index des releases. Interrogé en entier : `/releases/latest` rendrait la plus récente,
/// y compris une release purement RE sans installeur, et il faut la plus récente **signée**.
const URL_RELEASES: &str = "https://api.github.com/repos/aphrody-code/nie/releases";

/// La seule plate-forme publiée à ce jour. Le nom est celui de la table `platforms` de Tauri.
const PLATEFORME: &str = "windows-x86_64";

/// L'entrée d'une plate-forme dans le manifeste Tauri.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Plateforme {
    /// Contenu du fichier `.sig`, tel quel.
    pub signature: String,
    /// URL de l'installeur.
    pub url: String,
}

/// Le manifeste que le plugin updater de Tauri v2 attend.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Manifeste {
    /// Version sans le `v` du tag : le plugin compare des versions sémantiques.
    pub version: String,
    /// Notes de version, telles que la release les porte.
    pub notes: String,
    /// Date de publication, en RFC 3339.
    pub pub_date: String,
    /// Une entrée par plate-forme publiée.
    pub platforms: std::collections::BTreeMap<String, Plateforme>,
}

/// La release retenue, et l'URL de sa signature — qu'il reste à lire.
#[derive(Debug, PartialEq, Eq)]
pub struct Choix {
    /// Le manifeste, complet sauf la signature.
    pub version: String,
    /// Notes de version.
    pub notes: String,
    /// Date de publication.
    pub pub_date: String,
    /// URL de l'installeur NSIS.
    pub url_installeur: String,
    /// URL du fichier `.sig` qui l'accompagne.
    pub url_signature: String,
}

/// Choisit la release à servir dans la réponse de l'API GitHub.
///
/// Le critère est **l'installeur signé**, pas la date : une release qui ne publie que des
/// mesures de reverse-engineering est plus récente qu'une release d'installeur, et la retenir
/// proposerait une mise à jour qui ne s'installe pas. Le couple `-setup.exe` / `-setup.exe.sig`
/// doit être complet — une signature sans binaire, ou l'inverse, n'est pas une release
/// installable, et le plugin updater refuserait le téléchargement après l'avoir commencé.
///
/// # Errors
///
/// Rend [`ErreurSite::Amont`] si le corps n'est pas la liste JSON attendue, et
/// [`ErreurSite::Introuvable`] si aucune release ne porte d'installeur signé.
pub fn choisir(corps: &[u8]) -> Result<Choix, ErreurSite> {
    let selected =
        crate::update_policy::select_signed_release(corps).map_err(|error| match error {
            crate::update_policy::SelectionError::InvalidIndex => {
                ErreurSite::Amont("réponse de l'index des releases illisible".to_owned())
            }
            crate::update_policy::SelectionError::NoSignedInstaller => ErreurSite::Introuvable(
                format!("aucune release de {DEPOT} ne porte d'installeur signé"),
            ),
        })?;
    Ok(Choix {
        version: selected.version,
        notes: selected.notes,
        pub_date: selected.pub_date,
        url_installeur: selected.installer_url,
        url_signature: selected.signature_url,
    })
}

/// Assemble le manifeste une fois la signature lue.
#[must_use]
pub fn assembler(choix: Choix, signature: String) -> Manifeste {
    let selected = crate::update_policy::Selection {
        version: choix.version,
        notes: choix.notes,
        pub_date: choix.pub_date,
        installer_url: choix.url_installeur,
        signature_url: choix.url_signature,
    };
    let manifest = crate::update_policy::assemble_manifest(selected, signature, PLATEFORME);
    Manifeste {
        version: manifest.version,
        notes: manifest.notes,
        pub_date: manifest.pub_date,
        platforms: manifest
            .platforms
            .into_iter()
            .map(|(key, value)| {
                (
                    key,
                    Plateforme {
                        signature: value.signature,
                        url: value.url,
                    },
                )
            })
            .collect(),
    }
}

/// Récupère une URL, en passant par le cache partagé de la crate.
async fn recuperer(etat: &EtatSite, url: &str) -> Result<Bytes, ErreurSite> {
    if let Some(c) = etat.cache.get(url).await {
        return Ok(c.corps);
    }
    let reponse = etat
        .client
        .get(url)
        .header(header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                ErreurSite::Delai("GitHub n'a pas répondu dans le délai".to_owned())
            } else {
                ErreurSite::Amont("GitHub est injoignable".to_owned())
            }
        })?;
    if !reponse.status().is_success() {
        // Le code d'amont ne se propage pas tel quel : un 403 de rate-limit deviendrait un 403
        // que l'appelant lirait comme « interdit », alors qu'il doit réessayer plus tard.
        return Err(ErreurSite::Amont(format!(
            "GitHub a répondu {}",
            reponse.status().as_u16()
        )));
    }
    let corps = reponse
        .bytes()
        .await
        .map_err(|_| ErreurSite::Amont("réponse de GitHub tronquée".to_owned()))?;
    etat.cache
        .insert(
            url.to_owned(),
            ReponseCachee {
                corps: corps.clone(),
                type_contenu: "application/json".to_owned(),
                etag: String::new(),
            },
        )
        .await;
    Ok(corps)
}

/// `GET /downloads/inacord/latest.json`.
pub async fn inacord_latest(State(etat): State<EtatSite>) -> Response {
    let manifeste = async {
        let index = recuperer(&etat, URL_RELEASES).await?;
        let choix = choisir(&index)?;
        let brut = recuperer(&etat, &choix.url_signature).await?;
        let signature = String::from_utf8(brut.to_vec())
            .map_err(|_| ErreurSite::Amont("signature illisible".to_owned()))?
            .trim()
            .to_owned();
        if signature.is_empty() {
            return Err(ErreurSite::Amont("signature vide".to_owned()));
        }
        Ok::<_, ErreurSite>(assembler(choix, signature))
    }
    .await;

    match manifeste {
        Ok(m) => (
            StatusCode::OK,
            [
                (
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json"),
                ),
                // Une heure : l'updater est interrogé au démarrage de chaque installation, et
                // une nouvelle version n'a pas besoin d'être visible à la seconde.
                (
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("public, max-age=3600"),
                ),
            ],
            axum::Json(m),
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deux releases : la plus récente n'a pas d'installeur, la suivante en a un signé.
    const INDEX: &str = r#"[
        {"tag_name":"v0.5.11","body":null,"published_at":"2026-09-06T10:00:00Z",
         "draft":false,"prerelease":false,"assets":[]},
        {"tag_name":"v0.5.9","body":"des notes","published_at":"2026-09-01T10:00:00Z",
         "draft":false,"prerelease":false,"assets":[
            {"name":"niers_0.5.9_x64-setup.exe","browser_download_url":"https://exemple.test/s.exe"},
            {"name":"niers_0.5.9_x64-setup.exe.sig","browser_download_url":"https://exemple.test/s.exe.sig"},
            {"name":"niers_0.5.9_x64_en-US.msi","browser_download_url":"https://exemple.test/s.msi"}]}
    ]"#;

    #[test]
    fn la_release_retenue_est_la_derniere_signee_pas_la_plus_recente() {
        let c = choisir(INDEX.as_bytes()).expect("un choix");
        // 0.5.11 est plus recente, mais ne s'installe pas : proposer une mise a jour qui ne
        // s'installe pas est pire que ne rien proposer.
        assert_eq!(c.version, "0.5.9", "le `v` du tag est retire");
        assert_eq!(c.notes, "des notes");
        assert_eq!(c.url_installeur, "https://exemple.test/s.exe");
        assert_eq!(c.url_signature, "https://exemple.test/s.exe.sig");
    }

    #[test]
    fn un_installeur_sans_signature_n_est_pas_retenu() {
        let sans = INDEX.replace("niers_0.5.9_x64-setup.exe.sig", "autre-chose.txt");
        let e = choisir(sans.as_bytes()).expect_err("aucune release installable");
        assert_eq!(e.statut(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn les_brouillons_et_les_preversions_sont_ignores() {
        // La seule release installable de l'index est `v0.5.9`. La passer en brouillon, puis en
        // preversion, doit vider le choix dans les deux cas : une preversion proposee a toutes
        // les installations est une mise a jour que personne n'a demandee.
        for (avant, apres) in [
            (
                r#""published_at":"2026-09-01T10:00:00Z",
         "draft":false"#,
                r#""published_at":"2026-09-01T10:00:00Z",
         "draft":true"#,
            ),
            (
                r#""published_at":"2026-09-01T10:00:00Z",
         "draft":false,"prerelease":false"#,
                r#""published_at":"2026-09-01T10:00:00Z",
         "draft":false,"prerelease":true"#,
            ),
        ] {
            let modifie = INDEX.replace(avant, apres);
            assert_ne!(modifie, INDEX, "le remplacement doit mordre");
            assert!(
                choisir(modifie.as_bytes()).is_err(),
                "ni un brouillon ni une preversion ne se proposent"
            );
        }
    }

    #[test]
    fn un_corps_qui_n_est_pas_l_index_se_dit_amont_pas_interne() {
        let e = choisir(b"<html>pas du JSON</html>").expect_err("illisible");
        assert_eq!(e.statut(), StatusCode::BAD_GATEWAY);
    }

    #[test]
    fn le_manifeste_a_la_forme_qu_attend_tauri() {
        let c = choisir(INDEX.as_bytes()).expect("un choix");
        let m = assembler(c, "dW50ZXN0".to_owned());
        let v = serde_json::to_value(&m).expect("serialisable");
        assert_eq!(v["version"], "0.5.9");
        assert_eq!(v["pub_date"], "2026-09-01T10:00:00Z");
        assert_eq!(v["platforms"]["windows-x86_64"]["signature"], "dW50ZXN0");
        assert_eq!(
            v["platforms"]["windows-x86_64"]["url"],
            "https://exemple.test/s.exe"
        );
        // Les quatre clefs du contrat, et rien d'autre : un champ en trop est ignore par le
        // plugin, mais un champ manquant fait echouer la mise a jour sans message.
        let objet = v.as_object().expect("un objet");
        assert_eq!(objet.len(), 4, "version, notes, pub_date, platforms");
    }
}
