import {
	GameCountBadge,
	GameCursor,
	GameFilterPanel,
	GameKeyHint,
	GamePanel,
	GameSearchBar,
	GLYPHES,
	type GameFilterFamily,
	type GameFilterValue,
	useGameKeys,
} from "@nie/inacord-ui";
import { useAssetSource } from "@nie/inacord-ui";
import { ExplorerEntries, ExplorerSurface } from "@nie/inacord-ui/explorer/explorer-surface";
import { PaginationControls } from "@nie/inacord-ui/components/ui/pagination-controls";
import { browserLocationSnapshot, subscribeBrowserLocation, writeBrowserHistory } from "@nie/inacord-ui/lib/browser-navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NativeResources, type NativeAudioBank, type NativeVideoMetadata } from "../game/native-resources";
import { NativeMoviePlayer } from "../game/NativeMoviePlayer";
import { GameText } from "@nie/inacord-ui";
import type { AssetSource } from "@nie/asset-source";
import { api } from "../desktop/lib/api";
import type { FilmDto } from "../desktop/lib/bindings";
import { readableSize } from "./screen-parts";

const MOVIE_PAGE_SIZE = 24;

export interface MovieCatalogState {
	q: string;
	rubric: string | null;
	language: string | null;
	page: number;
}

/** Shareable semantic cinema state; all grouping values still come from the Rust catalogue. */
export function movieCatalogStateFromUrl(search: string): MovieCatalogState {
	const params = new URLSearchParams(search);
	const page = Number(params.get("page"));
	return {
		q: params.get("q")?.trim() ?? "",
		rubric: params.get("rubrique")?.trim() || null,
		language: params.get("langue")?.trim() || null,
		page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
	};
}

export function filterSemanticMovies(
	films: readonly FilmDto[],
	state: Pick<MovieCatalogState, "q" | "rubric" | "language">,
): FilmDto[] {
	const query = state.q.toLocaleLowerCase();
	return films.filter((film) =>
		(!state.rubric || film.rubrique === state.rubric)
		&& (!state.language || film.langue === state.language)
		&& (!query || `${film.nom} ${film.chemin} ${film.rubrique} ${film.langue ?? ""}`.toLocaleLowerCase().includes(query))
	);
}

function writeMovieCatalogState(state: MovieCatalogState): void {
	const url = new URL(window.location.href);
	for (const key of ["q", "rubrique", "langue", "page"]) url.searchParams.delete(key);
	if (state.q) url.searchParams.set("q", state.q);
	if (state.rubric) url.searchParams.set("rubrique", state.rubric);
	if (state.language) url.searchParams.set("langue", state.language);
	if (state.page > 1) url.searchParams.set("page", String(state.page));
	writeBrowserHistory(url, window.history.state, "replace");
}

const AUDIO_PAGE_SIZE = 80;

/** Keep the visible cue name while preventing it from creating a nested/invalid download path. */
export function audioCueFileName(name: string): string {
	const safe = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_") || "cue";
	return `${safe}.wav`;
}

/** Prefer the host's Rust decoder when it exposes one; native hosts keep the WASM fallback. */
export function audioCueSourceUrl(
	source: Pick<AssetSource, "urlAudio">,
	path: string,
	awbId: number | null,
): string | null {
	return awbId === null ? null : source.urlAudio?.(path, awbId) ?? null;
}

/** Find the nearest decodable cue without letting unresolved AWB rows trap navigation. */
export function adjacentPlayableCueIndex(
	cues: readonly Pick<NativeAudioBank["cues"][number], "awbId">[],
	selectedIndex: number,
	direction: -1 | 1,
): number {
	for (let index = selectedIndex + direction; index >= 0 && index < cues.length; index += direction) {
		if (cues[index]?.awbId !== null) return index;
	}
	return -1;
}

/**
 * Semantic movie catalogue owned by `nie_explore::cinema`.
 *
 * `/api/v1/videos` is intentionally still available as the raw VFS view, but it contains the
 * common/dx11 storage variants as separate files. This default projection consumes the one
 * `/assets/video/catalog.json` document also used by CinemaView, so a film, its rubric and its
 * audio tracks are never regrouped independently in the browser.
 */
export function SemanticMovieCatalog() {
	const location = useSyncExternalStore(subscribeBrowserLocation, browserLocationSnapshot, browserLocationSnapshot);
	const state = useMemo(() => movieCatalogStateFromUrl(new URL(location, "http://localhost").search), [location]);
	const [input, setInput] = useState(state.q);
	const [films, setFilms] = useState<FilmDto[] | null>(null);
	const [rubrics, setRubrics] = useState<string[]>([]);
	const [error, setError] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [filtersOpen, setFiltersOpen] = useState(false);

	useEffect(() => setInput(state.q), [state.q]);
	useEffect(() => {
		let active = true;
		setFilms(null);
		setError(false);
		api.videoCatalog().then((catalogue) => {
			if (!active) return;
			setFilms(catalogue.films);
			setRubrics(catalogue.rubriques);
		}).catch(() => { if (active) setError(true); });
		return () => { active = false; };
	}, [attempt]);

	const languages = useMemo(() => [...new Set((films ?? []).flatMap((film) => film.langue ? [film.langue] : []))].sort(), [films]);
	const families = useMemo<readonly GameFilterFamily[]>(() => [
		{
			id: "rubrique", label: "Rubrique", icon: "R", mode: "single",
			options: rubrics.map((rubric) => ({ value: rubric, label: rubric })),
		},
		{
			id: "langue", label: "Langue", icon: "L", mode: "single",
			options: languages.map((language) => ({ value: language, label: language })),
		},
	], [languages, rubrics]);
	const filterValue = useMemo<GameFilterValue>(() => ({
		rubrique: state.rubric ? [state.rubric] : [],
		langue: state.language ? [state.language] : [],
	}), [state.language, state.rubric]);
	const filtered = useMemo(() => filterSemanticMovies(films ?? [], state), [films, state]);
	const pages = Math.max(1, Math.ceil(filtered.length / MOVIE_PAGE_SIZE));
	const currentPage = Math.min(state.page, pages);
	const visible = filtered.slice((currentPage - 1) * MOVIE_PAGE_SIZE, currentPage * MOVIE_PAGE_SIZE);

	useEffect(() => {
		if (films && state.page > pages) writeMovieCatalogState({ ...state, page: pages });
	}, [films, pages, state]);

	return <section aria-label="Cinématiques du jeu">
		<ExplorerSurface
			error={error ? <>Le catalogue cinéma n’a pas pu être chargé. <button type="button" onClick={() => setAttempt(value => value + 1)}><GameText>Réessayer</GameText></button></> : undefined}
			status={<PaginationControls currentPage={currentPage} totalPages={pages} baseUrl={window.location.pathname}
				disabled={!films || error} onPageChange={page => writeMovieCatalogState({ ...state, page })}
				pageLabel={(page, total) => `Page ${page} sur ${total}`} />}
			toolbar={<div className="game-description-bar" style={{ display: "flex", flexWrap: "wrap", gap: "var(--jeu-espace-m)", margin: "var(--jeu-espace-m) 0" }}>
				<div style={{ flex: "1 1 18rem" }}><GameSearchBar value={input} onChange={setInput}
					onSubmit={q => writeMovieCatalogState({ ...state, q, page: 1 })}
					placeholder="Chercher une cinématique…" label="Chercher une cinématique" hotkey="x" /></div>
				<button type="button" className="game-button-secondary" onClick={() => setFiltersOpen(true)}>Filtres</button>
				{state.q || state.rubric || state.language ? <button type="button" className="game-button-secondary"
					onClick={() => writeMovieCatalogState({ q: "", rubric: null, language: null, page: 1 })}>Effacer</button> : null}
			</div>}
		>
			{filtersOpen ? <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: "var(--jeu-espace-l)", backdropFilter: "blur(3px)" }}>
				<GameFilterPanel families={families} value={filterValue} count={filtered.length} countUnit="cinématiques"
					onReset={() => writeMovieCatalogState({ ...state, rubric: null, language: null, page: 1 })}
					onConfirm={value => {
						writeMovieCatalogState({ ...state, rubric: value.rubrique?.[0] ?? null, language: value.langue?.[0] ?? null, page: 1 });
						setFiltersOpen(false);
					}}
					onClose={() => setFiltersOpen(false)} style={{ width: "min(900px, 100%)", maxHeight: "90vh" }} />
			</div> : null}
			{!films && !error ? <p>Chargement du catalogue cinéma…</p> : films && visible.length === 0 ? <p>Aucune cinématique ne correspond à cette recherche.</p> : films ? <>
				<p><GameCountBadge count={filtered.length} icon={GLYPHES.film} unit="cinématique" /></p>
				<ExplorerEntries viewMode="grid" gridSize={220} ariaLabel="Cinématiques">
					{visible.map((film) => <article role="listitem" key={film.chemin} className="game-info-window" style={{ padding: "var(--jeu-espace-s)" }}>
						<strong>{film.nom}</strong>
						<p>{film.rubrique}{film.langue ? ` · ${film.langue}` : ""}</p>
						<p>{readableSize(film.octets)}{film.duree !== null ? ` · ${film.duree.toFixed(1)} s` : ""}</p>
						{film.audio.length > 0 ? <p>{film.audio.length} piste(s) audio interne(s)</p> : film.bgm ? <p>Bande-son externe résolue</p> : <p>Pistes chargées à l’inspection</p>}
						<CatalogMoviePreview path={film.chemin} />
					</article>)}
				</ExplorerEntries>
			</> : null}
		</ExplorerSurface>
	</section>;
}

/** One selected ACB and one explicitly selected named cue; never an arbitrary bank waveform. */
export function CatalogAudioBank({ path, onClose }: { path: string; onClose: () => void }) {
	const source = useAssetSource();
	const [bank, setBank] = useState<NativeAudioBank | null>(null);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [page, setPage] = useState(1);
	const [selected, setSelected] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [pending, setPending] = useState(false);
	const [cueFailure, setCueFailure] = useState<string | null>(null);
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const loadCue = useRef<(name: string, awbId: number, index: number) => void>(() => {});
	const audio = useRef<HTMLAudioElement>(null);
	useEffect(() => {
		const resources = new NativeResources(source);
		let active = true;
		let generation = 0;
		let url: string | null = null;
		const clearAudio = () => {
			audio.current?.pause();
			if (url) URL.revokeObjectURL(url);
			url = null;
		};
		setBank(null); setFailed(false); setSelected(null); setSelectedIndex(null); setAudioUrl(null); setPage(1); setPending(false);
		resources.audioBank(path).then(value => { if (active) setBank(value); })
			.catch(() => { if (active) setFailed(true); });
		loadCue.current = (name, awbId, index) => {
			const request = ++generation;
			clearAudio(); setAudioUrl(null); setSelected(name); setSelectedIndex(index); setPending(true); setCueFailure(null);
			setPage(Math.floor(index / AUDIO_PAGE_SIZE) + 1);
			const sourceUrl = audioCueSourceUrl(source, path, awbId);
			if (sourceUrl) {
				setAudioUrl(sourceUrl);
				setPending(false);
				return;
			}
			resources.audioCue(path, name).then(blob => {
				if (!active || request !== generation) return;
				url = URL.createObjectURL(blob); setAudioUrl(url);
			}).catch(error => {
				if (active && request === generation) setCueFailure(String(error));
			})
				.finally(() => { if (active && request === generation) setPending(false); });
		};
		return () => { active = false; generation++; loadCue.current = () => {}; clearAudio(); resources.dispose(); };
	}, [source, path, attempt]);
	const pages = Math.ceil((bank?.cues.length ?? 0) / AUDIO_PAGE_SIZE);
	const previousIndex = bank && selectedIndex !== null
		? adjacentPlayableCueIndex(bank.cues, selectedIndex, -1)
		: -1;
	const nextIndex = bank && selectedIndex !== null
		? adjacentPlayableCueIndex(bank.cues, selectedIndex, 1)
		: -1;
	const loadIndex = (index: number) => {
		const cue = bank?.cues[index];
		if (cue?.awbId !== null && cue) loadCue.current(cue.name, cue.awbId, index);
	};
	// `Escape` closes the bank, and the footer hint is the very same handler — never a key cap
	// without a binding.
	useGameKeys(useMemo(() => [{ key: "Escape", onActivate: onClose, fromInputs: true }], [onClose]));
	return <div style={{
		position: "fixed", inset: "var(--jeu-espace-l)", zIndex: 100, overflow: "auto",
		background: "var(--jeu-ciel-clair)", borderRadius: "var(--jeu-rayon)",
	}}><GamePanel
		title="Banque audio"
		role="region"
		watermark={GLYPHES.onde}
		header={bank ? <GameCountBadge count={bank.cues.length} icon={GLYPHES.onde} unit="cue" /> : null}
		footer={<GameKeyHint keyLabel="Échap" onActivate={onClose}><GameText>Fermer</GameText></GameKeyHint>}
	>
		{failed ? <p role="alert">Cette banque est indisponible. <button type="button" onClick={() => setAttempt(value => value + 1)}><GameText>Réessayer</GameText></button></p>
			: !bank ? <p>Lecture du catalogue ACB…</p> : <>
				<p>{path}</p>
				<ul>{bank.cues.slice((page - 1) * AUDIO_PAGE_SIZE, page * AUDIO_PAGE_SIZE).map((cue, index) => {
					const absoluteIndex = (page - 1) * AUDIO_PAGE_SIZE + index;
					return <li key={`${cue.name}-${absoluteIndex}`}>
					{/* The cursor marks the cue that is actually loaded. */}
					{selectedIndex === absoluteIndex ? <GameCursor /> : null}
					<span>{cue.name} · {(cue.lengthMs / 1000).toFixed(2)} s </span>
					<button type="button" disabled={cue.awbId === null || (pending && selectedIndex === absoluteIndex)}
						onClick={() => cue.awbId !== null && loadCue.current(cue.name, cue.awbId, absoluteIndex)}>Charger cette cue</button>
					{cue.awbId === null ? <span> Forme d’onde non résolue</span> : null}
				</li>})}</ul>
				<PaginationControls currentPage={page} totalPages={pages} baseUrl={window.location.pathname} onPageChange={setPage} />
			</>}
		{selected ? <div aria-live="polite"><strong>{selected}</strong>{pending ? <p>Chargement…</p> : null}
			{cueFailure ? <p role="alert">Cette cue n’a pas pu être décodée : {cueFailure}</p> : null}
			<div role="group" aria-label="Navigation des cues">
				<button type="button" disabled={previousIndex < 0 || pending} onClick={() => loadIndex(previousIndex)}>Précédente</button>
				<button type="button" disabled={nextIndex < 0 || pending} onClick={() => loadIndex(nextIndex)}>Suivante</button>
				{audioUrl ? <a href={audioUrl} download={audioCueFileName(selected)}>Télécharger WAV</a> : null}
			</div>
			{audioUrl ? <audio key={audioUrl} ref={audio} src={audioUrl} controls preload="metadata"
				onError={() => setCueFailure("la ressource WAV fournie par l’hôte est illisible")}
				aria-label={selected} /> : null}</div> : null}
	</GamePanel></div>;
}

/** Inspection is demand-only. Playback uses the host's real paired resources, including its
 * existing MPEG-2 conversion path; it never calls the unsupported Wasm MPEG-2 remux binding. */
export function CatalogMoviePreview({ path }: { path: string }) {
	const source = useAssetSource();
	const [inspect, setInspect] = useState(false);
	const [metadata, setMetadata] = useState<NativeVideoMetadata | null>(null);
	const [failed, setFailed] = useState(false);
	const [playing, setPlaying] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		if (!inspect) return;
		const resources = new NativeResources(source);
		let active = true;
		setMetadata(null); setFailed(false); setPlaying(false);
		resources.videoMetadata(path).then(value => { if (active) setMetadata(value); })
			.catch(() => { if (active) setFailed(true); })
			.finally(() => resources.dispose());
		return () => { active = false; resources.dispose(); };
	}, [source, path, inspect, attempt]);
	if (!inspect) return <button type="button" onClick={() => setInspect(true)}>Inspecter la vidéo</button>;
	return <div>
		{failed ? <p role="alert">Cette vidéo ne peut pas être inspectée. <button type="button" onClick={() => setAttempt(value => value + 1)}><GameText>Réessayer</GameText></button></p>
			: !metadata ? <p>Lecture des pistes…</p> : <>
				<p>{metadata.video.codec} · {metadata.audioTracks.length} piste(s) audio</p>
				{metadata.audioTracks.map(track => <p key={track.channel}>Canal {track.channel} · {track.codec} · {track.channels} canaux · {track.sampleRate} Hz</p>)}
				{playing ? <><NativeMoviePlayer path={path} presentation="preview" onEnded={() => setPlaying(false)} />
					<button type="button" onClick={() => setPlaying(false)}><GameText>Arrêter</GameText></button></>
					: source.urlVideo && source.urlVideoAudio ? <button type="button" onClick={() => setPlaying(true)}>Lire avec bande-son</button>
						: <p>La lecture avec bande-son n’est pas disponible sur cet hôte.</p>}
			</>}
	</div>;
}
