import { useEffect, useMemo, useState } from "react";
import { formatBytes, normalizeCatalog, type DownloadItem, type ProductKind } from "./catalog";
import "./inacord-web.css";

const groups: Array<{ kind: ProductKind; title: string; eyebrow: string }> = [
	{ kind: "desktop", title: "Application desktop", eyebrow: "Windows · macOS · Linux" },
	{ kind: "cli", title: "Interface en ligne de commande", eyebrow: "Automatisation et scripts" },
	{ kind: "mobile", title: "Application mobile", eyebrow: "Android · iOS" },
	{ kind: "mcp", title: "Serveur MCP", eyebrow: "Outils pour agents compatibles" },
	{ kind: "plugin", title: "Plugins", eyebrow: "Blender et extensions" },
	{ kind: "web", title: "Interface web", eyebrow: "Aperçu en lecture seule" },
];

function Artifact({ item }: { item: DownloadItem }) {
	const meta = [item.version, item.platform, item.architecture, formatBytes(item.bytes)].filter(Boolean).join(" · ");
	return <article className="artifact">
		<div><h3>{item.name}</h3>{meta && <p className="artifact__meta">{meta}</p>}{item.description && <p>{item.description}</p>}{item.sha256 && <details><summary>SHA-256</summary><code>{item.sha256}</code></details>}</div>
		<div className="artifact__actions">
			{item.status === "available" && item.url
				? <a className="button button--download" href={item.url}>Télécharger <span aria-hidden="true">↓</span></a>
				: <span className="status">{item.status === "planned" ? "Prévu — non publié" : "Indisponible"}</span>}
			{item.signatureUrl && <a className="signature" href={item.signatureUrl}>Signature</a>}
		</div>
	</article>;
}

export default function DownloadPage() {
	const [items, setItems] = useState<DownloadItem[]>([]);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	useEffect(() => {
		const controller = new AbortController();
		fetch("/downloads/catalog.json", { headers: { Accept: "application/json" }, signal: controller.signal })
			.then(async response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<unknown>; })
			.then(payload => { setItems(normalizeCatalog(payload)); setState("ready"); })
			.catch(error => { if ((error as Error).name !== "AbortError") setState("error"); });
		return () => controller.abort();
	}, []);
	const byKind = useMemo(() => new Map(groups.map(group => [group.kind, items.filter(item => item.kind === group.kind)])), [items]);
	const other = items.filter(item => item.kind === "other");
	return <main className="downloads">
		<header className="masthead">
			<a className="wordmark" href="/" aria-label="Inacord, accueil"><span className="wordmark__mark">IN</span> INACORD</a>
			<nav><a href="#distributions">Distributions</a><a className="button button--ghost" href="/app">Ouvrir l’interface</a></nav>
		</header>
		<section className="hero">
			<div><p className="kicker">SUITE D’OUTILS INAZUMA ELEVEN</p><h1>Une interface.<br/><em>Tous les outils.</em></h1></div>
			<div className="hero__copy"><p>Explorez, inspectez et transformez vos fichiers avec les surfaces Inacord publiées pour votre plateforme.</p><p className="truth">Chaque lien ci-dessous vient du catalogue de distribution. Une cible sans artefact publié reste explicitement indisponible.</p></div>
		</section>
		<section className="catalog" id="distributions" aria-busy={state === "loading"}>
			<div className="section-heading"><span>01</span><h2>Distributions</h2><p>Catalogue actualisé par le service de publication</p></div>
			{state === "loading" && <div className="notice">Chargement du catalogue…</div>}
			{state === "error" && <div className="notice notice--error"><strong>Catalogue temporairement inaccessible.</strong><span>Aucun téléchargement ne peut être vérifié pour le moment.</span></div>}
			{state === "ready" && <div className="product-grid">
				{groups.map((group, index) => <section className="product" key={group.kind}>
					<div className="product__head"><span>{String(index + 1).padStart(2, "0")}</span><div><p>{group.eyebrow}</p><h2>{group.title}</h2></div></div>
					<div className="product__items">{(byKind.get(group.kind) ?? []).length ? byKind.get(group.kind)?.map(item => <Artifact key={item.id} item={item}/>) : <p className="empty">Aucun artefact publié dans le catalogue.</p>}</div>
				</section>)}
				{other.length > 0 && <section className="product"><div className="product__head"><span>+</span><div><p>Autres livrables</p><h2>Compléments</h2></div></div><div className="product__items">{other.map(item => <Artifact key={item.id} item={item}/>)}</div></section>}
			</div>}
		</section>
		<footer><span>INACORD</span><p>Les fonctions locales et les mises à jour intégrées nécessitent l’application desktop.</p><a href="/app">Aperçu web de l’interface →</a></footer>
	</main>;
}
