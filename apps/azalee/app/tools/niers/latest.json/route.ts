import { NextResponse } from "next/server";
import { fetchSignature, getLatestNiersDesktopRelease } from "@/lib/niers-releases";

// Endpoint updater Tauri pour l'app desktop niers (cf. `tauri.conf.json` → plugins.updater.endpoints
// du dépôt aphrody-code/nie). Format JSON statique attendu par le plugin
// (https://v2.tauri.app/plugin/updater) : { version, notes, pub_date, platforms: { "windows-x86_64":
// { signature, url } } }. Résolution de la release via `lib/niers-releases.ts` (source PARTAGÉE avec
// la page `/tools/niers` — un seul endroit qui sait parler à l'API GitHub Releases).
export const revalidate = 3600; // NIERS_RELEASE_REVALIDATE (littéral requis — segment config Next.js statiquement analysé)

export async function GET() {
	const release = await getLatestNiersDesktopRelease();
	if (!release) {
		return NextResponse.json({ error: "Aucune release desktop signée publiée" }, { status: 404 });
	}
	if (!release.nsis) {
		return NextResponse.json({ error: "Asset NSIS ou signature manquant" }, { status: 404 });
	}

	const signature = await fetchSignature(release.nsis.sigUrl);
	if (!signature) {
		return NextResponse.json({ error: "Signature illisible" }, { status: 502 });
	}

	return NextResponse.json({
		notes: release.notes,
		platforms: {
			"windows-x86_64": { signature, url: release.nsis.url },
		},
		pub_date: release.pubDate,
		version: release.version,
	});
}
