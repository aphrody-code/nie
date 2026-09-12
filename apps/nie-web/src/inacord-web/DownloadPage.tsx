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

	return <main className="downloads">
		<header className="masthead">
			<a className="wordmark" href="/" aria-label="Inacord, accueil"><span aria-hidden="true">IN</span>Inacord</a>
			<nav aria-label="Navigation principale">
				<a href="#downloads">Téléchargements</a>
				<a href="#docs">Docs rapides</a>
				<Button href="/app" variant="accent" size="sm" rounding="full">Ouvrir l’app</Button>
			</nav>
		</header>

		<section className="hero">
			<p className="eyebrow">INACORD TOOL SUITE</p>
			<h1>Tous les outils.<br/><span>Un seul endroit.</span></h1>
			<p>Desktop, CLI, MCP, mobile web et plugins. Téléchargements vérifiés depuis le catalogue de publication.</p>
			<div className="hero__actions">
				<Button href="#downloads" variant="accent" size="lg" rounding="full">Voir les téléchargements</Button>
				<Button href="/app" variant="gray" size="lg" rounding="full">Ouvrir l’app</Button>
			</div>
		</section>

		<Divider />

		<section className="catalog" id="downloads" aria-busy={state === "loading"}>
			<div className="section-heading"><h2>Téléchargements</h2><p>Versions, plateformes et empreintes en direct.</p></div>
			{state === "loading" && <Card className="notice" role="status">Chargement du catalogue…</Card>}
			{state === "error" && <Card className="notice notice--error" role="alert"><strong>Catalogue temporairement inaccessible.</strong><span>Aucun lien non vérifié n’est affiché.</span></Card>}
			{state === "ready" && <div className="artifact-grid" role="list">
				{sortedItems.map(item => <Artifact key={item.id} item={item}/>)}
				{sortedItems.length === 0 && <Card className="notice">Aucun artefact publié.</Card>}
			</div>}
		</section>

		<section className="quickstart" id="docs">
			<div className="section-heading"><h2>Docs rapides</h2><p>Commencer sans détour.</p></div>
			<div className="quickstart__grid">
				<div><span>01</span><h3>Desktop</h3><p>Lancez l’installateur. Les versions signées utilisent ensuite le canal stable de mise à jour.</p></div>
				<div><span>02</span><h3>CLI</h3><p>Extrayez l’archive, puis placez <code>niers</code> dans votre <code>PATH</code>.</p></div>
				<div><span>03</span><h3>MCP</h3><p>Déclarez <code>nie-mcp</code> comme serveur stdio dans votre client compatible.</p></div>
				<div><span>04</span><h3>Mobile</h3><p>Ouvrez <a href="/app">l’app web</a>, puis ajoutez-la à l’écran d’accueil.</p></div>
			</div>
		</section>

		<footer><span>Inacord</span><p>Les fonctions natives et l’écriture locale nécessitent l’application desktop.</p><a href="/downloads/catalog.json">Catalogue JSON</a></footer>
	</main>;
}
