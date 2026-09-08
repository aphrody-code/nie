//! Portable signed-release selection for update clients.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}
#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    body: Option<String>,
    published_at: String,
    assets: Vec<Asset>,
    draft: bool,
    prerelease: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Installable release selected from the upstream release index.
pub struct Selection {
    /// Release version without a leading `v`.
    pub version: String,
    /// Release notes.
    pub notes: String,
    /// Publication timestamp.
    pub pub_date: String,
    /// Installer download URL.
    pub installer_url: String,
    /// Detached-signature download URL.
    pub signature_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
/// Signed installer entry for one updater platform.
pub struct Platform {
    /// Detached signature contents.
    pub signature: String,
    /// Installer download URL.
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
/// Transport-neutral updater manifest.
pub struct Manifest {
    /// Release version.
    pub version: String,
    /// Release notes.
    pub notes: String,
    /// Publication timestamp.
    pub pub_date: String,
    /// Installers keyed by updater platform identifier.
    pub platforms: BTreeMap<String, Platform>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Failure to select an installable release.
pub enum SelectionError {
    /// The upstream body is not a release index.
    InvalidIndex,
    /// No stable release contains a matching installer and signature.
    NoSignedInstaller,
}

/// Select the first stable release containing a signed Windows installer.
pub fn select_signed_release(body: &[u8]) -> Result<Selection, SelectionError> {
    let releases: Vec<Release> =
        serde_json::from_slice(body).map_err(|_| SelectionError::InvalidIndex)?;
    for release in releases
        .iter()
        .filter(|release| !release.draft && !release.prerelease)
    {
        let Some(installer) = release
            .assets
            .iter()
            .find(|asset| asset.name.ends_with("-setup.exe"))
        else {
            continue;
        };
        let signature_name = format!("{}.sig", installer.name);
        let Some(signature) = release
            .assets
            .iter()
            .find(|asset| asset.name == signature_name)
        else {
            continue;
        };
        return Ok(Selection {
            version: release
                .tag_name
                .strip_prefix('v')
                .unwrap_or(&release.tag_name)
                .to_owned(),
            notes: release.body.clone().unwrap_or_default(),
            pub_date: release.published_at.clone(),
            installer_url: installer.browser_download_url.clone(),
            signature_url: signature.browser_download_url.clone(),
        });
    }
    Err(SelectionError::NoSignedInstaller)
}

#[must_use]
/// Assemble the updater manifest after the transport has fetched the signature.
pub fn assemble_manifest(selection: Selection, signature: String, platform: &str) -> Manifest {
    let mut platforms = BTreeMap::new();
    platforms.insert(
        platform.to_owned(),
        Platform {
            signature,
            url: selection.installer_url,
        },
    );
    Manifest {
        version: selection.version,
        notes: selection.notes,
        pub_date: selection.pub_date,
        platforms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selects_first_stable_release_with_matching_signature() {
        let body = br#"[{"tag_name":"v2.0.0","body":null,"published_at":"new","draft":false,"prerelease":false,"assets":[]},{"tag_name":"v1.2.3","body":"ok","published_at":"then","draft":false,"prerelease":false,"assets":[{"name":"inacord-setup.exe","browser_download_url":"exe"},{"name":"inacord-setup.exe.sig","browser_download_url":"sig"}]}]"#;
        let selected = select_signed_release(body).unwrap();
        assert_eq!(selected.version, "1.2.3");
        let manifest = assemble_manifest(selected, "signed".into(), "windows-x86_64");
        assert_eq!(manifest.platforms["windows-x86_64"].url, "exe");
    }
    #[test]
    fn rejects_invalid_or_unsigned_indexes() {
        assert_eq!(
            select_signed_release(b"bad"),
            Err(SelectionError::InvalidIndex)
        );
        assert_eq!(
            select_signed_release(br#"[]"#),
            Err(SelectionError::NoSignedInstaller)
        );
    }
}
