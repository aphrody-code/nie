/**
 * Résolveur de la dernière release desktop **niers** (GitHub Releases, `aphrody-code/nie`) —
 * source UNIQUE pour `/tools/niers` (page de download) **et** `/tools/niers/latest.json`
 * (manifeste updater Tauri) : azalee n'a plus besoin d'être redéployée à chaque nouvelle version
 * niers, la dernière release publiée (non-draft/non-prerelease) qui embarque un installeur NSIS
 * signé (`*-setup.exe` + `.sig`) devient automatiquement la version proposée.
 */

const REPO = "aphrody-code/nie";

/** Évite de marteler l'API GitHub (rate-limit anonyme 60 req/h/IP) — même valeur pour la page et le JSON. */
export const NIERS_RELEASE_REVALIDATE = 3600;

interface GhAsset {
	name: string;
	browser_download_url: string;
}

interface GhRelease {
	tag_name: string;
	body: string | null;
	published_at: string;
	html_url: string;
	assets: GhAsset[];
	draft: boolean;
	prerelease: boolean;
}

interface NiersAsset {
	name: string;
	url: string;
}

/** Vue normalisée d'une release desktop niers — `null` sur les champs dont l'asset est absent. */
export interface NiersDesktopRelease {
	version: string;
	tag: string;
	notes: string;
	pubDate: string;
	releaseUrl: string;
	msi: NiersAsset | null;
	nsis: (NiersAsset & { sigUrl: string }) | null;
	blenderZip: NiersAsset | null;
}

/** Récupère et normalise la dernière release desktop signée. `null` si GitHub est indisponible ou
 * si aucune release ne contient d'installeur NSIS signé (cas d'une release purement RE/sans binaire). */
export async function getLatestNiersDesktopRelease(): Promise<NiersDesktopRelease | null> {
	const res = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
		headers: { Accept: "application/vnd.github+json" },
		next: { revalidate: NIERS_RELEASE_REVALIDATE },
	});
	if (!res.ok) return null;

	const releases = (await res.json()) as GhRelease[];
	const release = releases.find(
		(r) => !r.draft && !r.prerelease && r.assets.some((a) => a.name.endsWith("-setup.exe.sig"))
	);
	if (!release) return null;

	const findAsset = (predicate: (name: string) => boolean): NiersAsset | null => {
		const asset = release.assets.find((a) => predicate(a.name));
		return asset ? { name: asset.name, url: asset.browser_download_url } : null;
	};

	const nsisAsset = findAsset((n) => n.endsWith("-setup.exe"));
	const nsisSig = findAsset((n) => n === `${nsisAsset?.name}.sig`);

	return {
		blenderZip: findAsset((n) => n.endsWith(".zip")),
		msi: findAsset((n) => n.endsWith(".msi")),
		notes: release.body ?? "",
		nsis: nsisAsset && nsisSig ? { ...nsisAsset, sigUrl: nsisSig.url } : null,
		pubDate: release.published_at,
		releaseUrl: release.html_url,
		tag: release.tag_name,
		version: release.tag_name.replace(/^v/, ""),
	};
}

/** Télécharge le contenu texte d'un fichier `.sig` minisign (petit, jamais mis en cache côté navigateur). */
export async function fetchSignature(url: string): Promise<string | null> {
	const res = await fetch(url, { next: { revalidate: NIERS_RELEASE_REVALIDATE } });
	if (!res.ok) return null;
	return (await res.text()).trim();
}
