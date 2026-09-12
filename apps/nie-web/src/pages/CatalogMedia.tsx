import {
	GameCountBadge,
	GameCursor,
	GameKeyHint,
	GamePanel,
	GLYPHES,
	useGameKeys,
} from "@niers/inacord-ui";
import { useAssetSource } from "@niers/inacord-ui";
import { PaginationControls } from "@niers/inacord-ui/components/ui/pagination-controls";
import { useEffect, useMemo, useRef, useState } from "react";
import { NativeResources, type NativeAudioBank, type NativeVideoMetadata } from "../game/native-resources";
import { NativeMoviePlayer } from "../game/NativeMoviePlayer";

/** One selected ACB and one explicitly selected named cue; never an arbitrary bank waveform. */
export function CatalogAudioBank({ path, onClose }: { path: string; onClose: () => void }) {
	const source = useAssetSource();
	const [bank, setBank] = useState<NativeAudioBank | null>(null);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [page, setPage] = useState(1);
	const [selected, setSelected] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [cueFailed, setCueFailed] = useState(false);
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const loadCue = useRef<(name: string) => void>(() => {});
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
		setBank(null); setFailed(false); setSelected(null); setAudioUrl(null); setPage(1); setPending(false);
		resources.audioBank(path).then(value => { if (active) setBank(value); })
			.catch(() => { if (active) setFailed(true); });
		loadCue.current = name => {
			const request = ++generation;
			clearAudio(); setAudioUrl(null); setSelected(name); setPending(true); setCueFailed(false);
			resources.audioCue(path, name).then(blob => {
				if (!active || request !== generation) return;
				url = URL.createObjectURL(blob); setAudioUrl(url);
			}).catch(() => { if (active && request === generation) setCueFailed(true); })
				.finally(() => { if (active && request === generation) setPending(false); });
		};
		return () => { active = false; generation++; loadCue.current = () => {}; clearAudio(); resources.dispose(); };
	}, [source, path, attempt]);
	const pages = Math.ceil((bank?.cues.length ?? 0) / 80);
	// `Escape` closes the bank, and the footer hint is the very same handler — never a key cap
	// without a binding.
	useGameKeys(useMemo(() => [{ key: "Escape", onActivate: onClose, fromInputs: true }], [onClose]));
	return <GamePanel
		title="Banque audio"
		role="region"
		watermark={GLYPHES.onde}
		header={bank ? <GameCountBadge count={bank.cues.length} icon={GLYPHES.onde} unit="cue" /> : null}
		footer={<GameKeyHint keyLabel="Échap" onActivate={onClose}>Fermer</GameKeyHint>}
	>
		{failed ? <p role="alert">Cette banque est indisponible. <button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></p>
			: !bank ? <p>Lecture du catalogue ACB…</p> : <>
				<p>{path}</p>
				<ul>{bank.cues.slice((page - 1) * 80, page * 80).map((cue, index) => <li key={`${cue.name}-${index}`}>
					{/* The cursor marks the cue that is actually loaded. */}
					{selected === cue.name ? <GameCursor /> : null}
					<span>{cue.name} · {(cue.lengthMs / 1000).toFixed(2)} s </span>
					<button type="button" disabled={cue.awbId === null || (pending && selected === cue.name)}
						onClick={() => loadCue.current(cue.name)}>Charger cette cue</button>
					{cue.awbId === null ? <span> Forme d’onde non résolue</span> : null}
				</li>)}</ul>
				<PaginationControls currentPage={page} totalPages={pages} baseUrl={window.location.pathname} onPageChange={setPage} />
			</>}
		{selected ? <div aria-live="polite"><strong>{selected}</strong>{pending ? <p>Chargement…</p> : null}
			{cueFailed ? <p role="alert">Cette cue n’a pas pu être décodée.</p> : null}
			{audioUrl ? <audio key={audioUrl} ref={audio} src={audioUrl} controls preload="metadata"
				onError={() => setCueFailed(true)} aria-label={selected} /> : null}</div> : null}
	</GamePanel>;
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
		{failed ? <p role="alert">Cette vidéo ne peut pas être inspectée. <button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></p>
			: !metadata ? <p>Lecture des pistes…</p> : <>
				<p>{metadata.video.codec} · {metadata.audioTracks.length} piste(s) audio</p>
				{metadata.audioTracks.map(track => <p key={track.channel}>Canal {track.channel} · {track.codec} · {track.channels} canaux · {track.sampleRate} Hz</p>)}
				{playing ? <><NativeMoviePlayer path={path} presentation="preview" onEnded={() => setPlaying(false)} />
					<button type="button" onClick={() => setPlaying(false)}>Arrêter</button></>
					: source.urlVideo && source.urlVideoAudio ? <button type="button" onClick={() => setPlaying(true)}>Lire avec bande-son</button>
						: <p>La lecture avec bande-son n’est pas disponible sur cet hôte.</p>}
			</>}
	</div>;
}
