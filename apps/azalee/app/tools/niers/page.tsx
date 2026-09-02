import type { Metadata } from "next";
import { Button } from "@rosegriffon/ui";
import { Icon } from "@/components/ui/Icon";
import { getLatestNiersDesktopRelease, type NiersDesktopRelease } from "@/lib/niers-releases";

// Page 100 % DYNAMIQUE côté données de version : `getLatestNiersDesktopRelease()` (source partagée
// avec `/tools/niers/latest.json`, l'endpoint updater Tauri) résout la dernière release GitHub à
// chaque revalidation — plus aucune version/tag/nom de fichier en dur à mettre à jour manuellement
// ici après une nouvelle release niers (cf. `scripts/release-desktop.sh` côté dépôt niers).
export const revalidate = 3600; // NIERS_RELEASE_REVALIDATE (littéral requis — segment config Next.js statiquement analysé)

const GITHUB_REPO_URL = "https://github.com/aphrody-code/nie";

export const metadata: Metadata = {
	alternates: { canonical: "/tools/niers" },
	description:
		"niers : explorateur de données et extension Blender pour Inazuma Eleven: Victory Road. Parcourez les fichiers du jeu, prévisualisez modèles 3D/textures/vidéos/sons, gérez vos mods et importez directement dans Blender.",
	openGraph: {
		description:
			"Explorateur de données et extension Blender pour Inazuma Eleven: Victory Road — prévisualisation 3D/image/vidéo/audio, recherche précise, mods, sauvegardes.",
		locale: "fr_FR",
		siteName: "Azalée - Inazuma Eleven Victory Road",
		title: "niers | Azalée",
		type: "website",
		url: "/tools/niers",
	},
	title: "niers — Explorateur de données & extension Blender - Azalée",
};

/** Bouton de téléchargement — désactivé + libellé explicite si la release GitHub est indisponible
 * (panne API, aucune release signée publiée) plutôt qu'un lien mort silencieux. */
function DownloadButton({
	asset,
	children,
	icon = "download",
	variant,
}: {
	asset: { url: string } | null;
	children: React.ReactNode;
	icon?: string;
	variant?: "outline";
}) {
	if (!asset) {
		return (
			<Button disabled size="lg" variant={variant}>
				<Icon name="download" size={20} />
				Indisponible
			</Button>
		);
	}
	return (
		<Button asChild size="lg" variant={variant}>
			<a href={asset.url} download>
				<Icon name={icon} size={20} />
				{children}
			</a>
		</Button>
	);
}

export default async function NiersToolPage() {
	const release: NiersDesktopRelease | null = await getLatestNiersDesktopRelease();

	return (
		<div className="
   w-full flex flex-col items-center gap-10
   sm:gap-14
   pb-8 overflow-x-clip
 ">
			{/* Nom + version : la seule typographie de la page, dans la police de marque. */}
			<header className="flex flex-col items-center gap-3 pt-4 text-center">
				<h1 className="
    font-[BradBunR] text-4xl
    sm:text-5xl
    md:text-6xl
    text-on-surface tracking-wide
    animate-[fadeSlideUp_0.7s_ease-out_0.05s_both]
  ">
					niers
				</h1>
				<p className="
    type-label-large text-on-surface-variant tabular-nums
    animate-[fadeSlideUp_0.7s_ease-out_0.15s_both]
  ">
					{release ? `v${release.version}` : "Windows x64"}
					{release ? " · Windows x64" : ""}
				</p>
			</header>

			{/* Téléchargement : l'action principale, au-dessus de la capture. */}
			<div className="
   flex flex-wrap items-center justify-center gap-3
   animate-[fadeSlideUp_0.7s_ease-out_0.25s_both]
 ">
				<DownloadButton asset={release?.msi ?? null}>Télécharger (.msi)</DownloadButton>
				<DownloadButton asset={release?.nsis ?? null} variant="outline">
					.exe
				</DownloadButton>
				<DownloadButton asset={release?.blenderZip ?? null} icon="extension" variant="outline">
					Blender
				</DownloadButton>
				<Button asChild size="lg" variant="outline">
					<a href={GITHUB_REPO_URL} aria-label="Code source sur GitHub">
						<Icon name="code" size={20} />
					</a>
				</Button>
			</div>

			{/* La capture porte toute la démonstration : entrée en fondu, flottement lent,
			 * halo coloré derrière le cadre, léger rapprochement au survol.
			 * `/niers/app.webp` n'a JAMAIS été déposé dans public/ (404 constaté 2026-08-15,
			 * audit d'images du site) : le bloc reste désactivé plutôt que de fabriquer une
			 * fausse capture — cf. mémoire "tools-niers-screenshot-manquant" pour capturer une
			 * vraie capture via la skill `run` avant de le réactiver. */}

			{!release && (
				<p className="type-body-small text-error">
					Release GitHub indisponible —{" "}
					<a href={`${GITHUB_REPO_URL}/releases`} className="underline underline-offset-2">
						page des releases
					</a>
				</p>
			)}
		</div>
	);
}
