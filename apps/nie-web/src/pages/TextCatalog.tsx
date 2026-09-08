import { useEffect, useMemo, useState } from "react";
import { splitLanguagePrefix } from "../routing";

type TextFamily = { family: string; languages: string[]; files: number; lines: number };
type TextCatalog = { languages: { language: string; lines: number }[]; families: TextFamily[]; files: number; lines: number };
type TextLine = { hash: number; hash_hex: string; text: string; file: string };
type TextPage = { files: string[]; q: string | null; total_unfiltered: number; results: { elements: TextLine[]; page: number; pages: number; total: number } };

/** Native text-CFG browser: it reads the measured server catalogue and never mirrors strings in JS. */
export function TextCatalog() {
	const locale = splitLanguagePrefix(window.location.pathname).prefix === "/en" ? "en"
		: splitLanguagePrefix(window.location.pathname).prefix === "/ja" ? "ja" : "fr";
	const [catalog, setCatalog] = useState<TextCatalog | null>(null);
	const [family, setFamily] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [submitted, setSubmitted] = useState("");
	const [page, setPage] = useState<TextPage | null>(null);
	const [error, setError] = useState(false);

	useEffect(() => {
		const controller = new AbortController();
		setError(false);
		fetch("/api/v1/text", { signal: controller.signal }).then(response => {
			if (!response.ok) throw new Error("Text catalogue unavailable");
			return response.json() as Promise<TextCatalog>;
		}).then(value => {
			if (controller.signal.aborted) return;
			setCatalog(value);
			setFamily(current => current && value.families.some(item => item.family === current && item.languages.includes(locale))
				? current : value.families.find(item => item.languages.includes(locale))?.family ?? null);
		}).catch(() => { if (!controller.signal.aborted) setError(true); });
		return () => controller.abort();
	}, [locale]);

	useEffect(() => {
		if (!family) return;
		const controller = new AbortController();
		setPage(null); setError(false);
		const params = new URLSearchParams({ page: "1", per_page: "100" });
		if (submitted.trim()) params.set("q", submitted.trim());
		fetch(`/api/v1/text/${encodeURIComponent(locale)}/${encodeURIComponent(family)}?${params}`, { signal: controller.signal })
			.then(response => { if (!response.ok) throw new Error("Text family unavailable"); return response.json() as Promise<TextPage>; })
			.then(value => { if (!controller.signal.aborted) setPage(value); })
			.catch(() => { if (!controller.signal.aborted) setError(true); });
		return () => controller.abort();
	}, [family, locale, submitted]);

	const available = useMemo(() => catalog?.families.filter(item => item.languages.includes(locale)) ?? [], [catalog, locale]);
	return <section aria-label="Textes du jeu" className="space-y-4">
		<header className="flex flex-wrap items-center gap-3"><h2>Textes du jeu</h2>
			{catalog && <span>{catalog.lines.toLocaleString(locale)} lignes · {catalog.files.toLocaleString(locale)} fichiers</span>}
			<span>Langue : {locale.toUpperCase()}</span></header>
		{error && <p role="alert">Les textes du jeu ne sont pas disponibles pour le moment.</p>}
		<div className="flex flex-wrap gap-2" role="tablist" aria-label="Familles de texte">
			{available.map(item => <button type="button" key={item.family} role="tab" aria-selected={family === item.family}
				onClick={() => { setFamily(item.family); setSubmitted(""); setQuery(""); }}>
				{item.family} ({item.lines.toLocaleString(locale)})
			</button>)}
		</div>
		<form onSubmit={event => { event.preventDefault(); setSubmitted(query); }} className="flex gap-2">
			<input aria-label="Chercher dans cette famille" value={query} onChange={event => setQuery(event.target.value)} placeholder="Chercher le texte natif…" />
			<button type="submit">Chercher</button>
		</form>
		{page && <><p>{page.results.total.toLocaleString(locale)} ligne(s){page.q ? ` pour « ${page.q} »` : ""} · {page.files.length} fichier(s) VFS</p>
			<ul className="space-y-2">{page.results.elements.map((line, index) => <li key={`${line.file}:${line.hash}:${index}`}>
				<p>{line.text}</p><code>{line.hash_hex} · {line.file}</code>
			</li>)}</ul></>}
	</section>;
}
