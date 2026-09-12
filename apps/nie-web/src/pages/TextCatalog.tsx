import { useEffect, useMemo, useState } from "react";
import {
	GameCountBadge,
	GameCursor,
	GameHeaderBar,
	GamePanel,
	GameSearchBar,
	GLYPHES,
} from "@niers/inacord-ui";
import { useSettings } from "@niers/inacord-ui/lib/settings";

type TextFamily = { family: string; languages: string[]; files: number; lines: number };
type TextCatalog = { languages: { language: string; lines: number }[]; families: TextFamily[]; files: number; lines: number };
type TextLine = { hash: number; hash_hex: string; text: string; file: string };
type TextPage = { files: string[]; q: string | null; total_unfiltered: number; results: { elements: TextLine[]; page: number; pages: number; total: number } };

/** Native text-CFG browser: it reads the measured server catalogue and never mirrors strings in JS. */
export function TextCatalog() {
	const { gameLocale } = useSettings();
	const locale = gameLocale;
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
	const current = useMemo(() => available.find(item => item.family === family) ?? null, [available, family]);
	return <section aria-label="Textes du jeu" className="space-y-4">
		{/* The game header bar, its icon and its live count: the same shape as `data/menu/options.png`. */}
		<GameHeaderBar icon={GLYPHES.livre} title="Textes du jeu">
			{catalog ? <GameCountBadge count={catalog.lines} icon={GLYPHES.livre} unit="ligne" /> : null}
			<span>{catalog ? `${catalog.files.toLocaleString(locale)} fichiers · ` : ""}Langue : {locale.toUpperCase()}</span>
		</GameHeaderBar>
		{error && <p role="alert">Les textes du jeu ne sont pas disponibles pour le moment.</p>}
		<GamePanel
			title="Familles"
			role="region"
			watermark={GLYPHES.livre}
			footer={current ? <GameCountBadge count={current.lines} icon={GLYPHES.livre} unit="ligne" /> : null}
		>
			<div className="flex flex-wrap gap-2" role="tablist" aria-label="Familles de texte">
				{available.map(item => <button type="button" key={item.family} role="tab" aria-selected={family === item.family}
					className="game-button-secondary inline-flex items-center gap-1"
					onClick={() => { setFamily(item.family); setSubmitted(""); setQuery(""); }}>
					{/* The cursor only marks the family that is actually selected. */}
					{family === item.family ? <GameCursor /> : null}
					{item.family} ({item.lines.toLocaleString(locale)})
				</button>)}
			</div>
		</GamePanel>
		{/* `x` focuses the field, exactly as the bank screen of the game does. */}
		<GameSearchBar
			value={query}
			onChange={setQuery}
			onSubmit={setSubmitted}
			hotkey="x"
			placeholder="Chercher le texte natif…"
			label="Chercher dans cette famille"
		/>
		{page && <><p>{page.results.total.toLocaleString(locale)} ligne(s){page.q ? ` pour « ${page.q} »` : ""} · {page.files.length} fichier(s) VFS</p>
			<ul className="space-y-2">{page.results.elements.map((line, index) => <li key={`${line.file}:${line.hash}:${index}`}>
				<p>{line.text}</p><code>{line.hash_hex} · {line.file}</code>
			</li>)}</ul></>}
	</section>;
}
