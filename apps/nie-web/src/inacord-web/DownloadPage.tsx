/**
 * `/downloads` — le catalogue des builds natifs, **un écran du produit**.
 *
 * ## Ce qui a été fusionné ici, le 2026-09-12
 *
 * Le même `catalog.json` était rendu deux fois : par cette page, et par un `DownloadModal` ouvert
 * depuis le pied de la barre latérale — deux mises en page, deux libellés, et dans la modale une
 * liste d'artefacts **écrite en dur** servant de repli quand la requête échouait, avec des URL de
 * téléchargement qui ne prouvaient rien. Un seul rendu subsiste, celui qui n'affiche que ce que
 * le catalogue publie ; le bouton du pied navigue ici au lieu d'ouvrir une seconde vue.
 *
 * De cette page ont disparu son bandeau de marque, son titre d'accueil et ses deux boutons
 * « Ouvrir l'app » vers `/app` — une adresse que le site ne sert pas (404, mesuré). Dans la
 * coquille unique, la barre latérale dit déjà où l'on est et l'application est déjà ouverte.
 *
 * L'installation de l'application web (`beforeinstallprompt`) vient de la modale : c'est le seul
 * geste qu'elle offrait et que cette page n'avait pas.
 */
import { Button, Card, CardContent, Divider } from "@aphrody/spaceui";
import { useEffect, useMemo, useState } from "react";
import { formatBytes, normalizeCatalog, type DownloadItem, type ProductKind } from "./catalog";

const groupNames: Record<ProductKind, string> = {
	desktop: "Desktop",
	cli: "CLI",
	mobile: "Mobile",
	mcp: "MCP",
	plugin: "Plugins",
	web: "Web",
	other: "Autres",
};

/** L'événement que Chromium émet quand l'application web est installable. Non standardisé. */
interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function Artifact({ item }: { item: DownloadItem }) {
	const meta = [item.platform, item.architecture, item.version ? `v${item.version.replace(/^v/u, "")}` : undefined, formatBytes(item.bytes)]
		.filter(Boolean)
		.join(" · ");
	return <Card className="artifact" role="listitem">
		<CardContent className="artifact__content">
			<div className="artifact__heading">
				<span className="artifact__kind">{groupNames[item.kind]}</span>
				<h2>{item.name}</h2>
			</div>
			{meta && <p className="artifact__meta">{meta}</p>}
			{item.description && <p className="artifact__description">{item.description}</p>}
			{item.sha256 && <details><summary>SHA-256</summary><code>{item.sha256}</code></details>}
		</CardContent>
		<div className="artifact__actions">
			{item.status === "available" && item.url
				? <Button href={item.url} variant="accent" size="md" rounding="full">Télécharger <span aria-hidden="true">↓</span></Button>
				: <span className="artifact__status">{item.status === "planned" ? "Prévu" : "Indisponible"}</span>}
			{item.signatureUrl && <Button href={item.signatureUrl} variant="bare" size="xs">Signature</Button>}
		</div>
	</Card>;
}

/**
 * Installer l'application web.
 *
 * Le bouton n'apparaît que si le navigateur a VRAIMENT proposé l'installation : sans
 * `beforeinstallprompt`, il n'y a rien à déclencher, et un bouton qui ouvrirait une boîte de
 * dialogue expliquant d'aller chercher dans le menu du navigateur n'est pas une installation.
 */
function InstallWebApp() {
	const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
	const [installed, setInstalled] = useState(false);
	useEffect(() => {
		const offer = (event: Event) => {
			event.preventDefault();
			setPrompt(event as BeforeInstallPromptEvent);
		};
		const done = () => {
			setInstalled(true);
			setPrompt(null);
		};
		window.addEventListener("beforeinstallprompt", offer);
		window.addEventListener("appinstalled", done);
		return () => {
			window.removeEventListener("beforeinstallprompt", offer);
			window.removeEventListener("appinstalled", done);
		};
	}, []);
	if (installed) return <p className="artifact__status">Application web installée.</p>;
	if (!prompt) return null;
	return (
		<Button
			variant="gray"
			size="md"
			rounding="full"
			onClick={async () => {
				await prompt.prompt();
				const choice = await prompt.userChoice;
				if (choice.outcome === "accepted") setInstalled(true);
				setPrompt(null);
			}}
		>
			Installer l’application web
		</Button>
	);
}

export default function DownloadPage() {
	const [items, setItems] = useState<DownloadItem[]>([]);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");

	useEffect(() => {
		const controller = new AbortController();
		fetch("/downloads/catalog.json", { headers: { Accept: "application/json" }, signal: controller.signal })
			.then(async response => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.json() as Promise<unknown>;
			})
			.then(payload => {
				setItems(normalizeCatalog(payload));
				setState("ready");
			})
			.catch(error => {
				if ((error as Error).name !== "AbortError") setState("error");
			});
		return () => controller.abort();
	}, []);

	const sortedItems = useMemo(() => [...items].sort((a, b) => {
		if (a.status === "available" && b.status !== "available") return -1;
		if (a.status !== "available" && b.status === "available") return 1;
		return Object.keys(groupNames).indexOf(a.kind) - Object.keys(groupNames).indexOf(b.kind);
	}), [items]);

	return <div className="downloads">
		<section className="catalog" id="downloads" aria-busy={state === "loading"}>
			<div className="section-heading">
				<h2>Téléchargements</h2>
				<p>Versions, plateformes et empreintes en direct.</p>
			</div>
			<p className="downloads__intro">
				Desktop, CLI, MCP, application web mobile et plugins. Les fonctions natives et
				l’écriture locale demandent l’application de bureau ; tout le reste est déjà ouvert
				autour de cette page.
			</p>
			<div className="hero__actions"><InstallWebApp /></div>
			{state === "loading" && <Card className="notice" role="status">Chargement du catalogue…</Card>}
			{state === "error" && <Card className="notice notice--error" role="alert"><strong>Catalogue temporairement inaccessible.</strong><span>Aucun lien non vérifié n’est affiché.</span></Card>}
			{state === "ready" && <div className="artifact-grid" role="list">
				{sortedItems.map(item => <Artifact key={item.id} item={item}/>)}
				{sortedItems.length === 0 && <Card className="notice">Aucun artefact publié.</Card>}
			</div>}
		</section>

		<Divider />

		<section className="quickstart" id="docs">
			<div className="section-heading"><h2>Docs rapides</h2><p>Commencer sans détour.</p></div>
			<div className="quickstart__grid">
				<div><span>01</span><h3>Desktop</h3><p>Lancez l’installateur. Les versions signées utilisent ensuite le canal stable de mise à jour.</p></div>
				<div><span>02</span><h3>CLI</h3><p>Extrayez l’archive, puis placez <code>niers</code> dans votre <code>PATH</code>.</p></div>
				<div><span>03</span><h3>MCP</h3><p>Déclarez <code>nie-mcp</code> comme serveur stdio dans votre client compatible.</p></div>
				<div><span>04</span><h3>Mobile</h3><p>Ajoutez cette page à votre écran d’accueil ; le bouton ci-dessus le fait quand le navigateur le propose.</p></div>
			</div>
		</section>

		<footer><a href="/downloads/catalog.json">Catalogue JSON</a></footer>
	</div>;
}
