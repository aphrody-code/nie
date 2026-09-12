import { useAssetSource } from "@niers/inacord-ui";
import { playMediaPair, synchronizeMediaClock } from "@niers/inacord-ui/lib/media-sync";
import { useEffect, useRef, useState } from "react";
import { acquireOpeningMedia } from "./opening-media";
import { GameText } from "@niers/inacord-ui";

/** Native movie host shared by opening playback and demand-activated media inspection. */
export function NativeMoviePlayer({ path, onReady, onEnded, presentation = "opening" }: {
	path: string; onReady?: () => void; onEnded?: () => void; presentation?: "opening" | "preview";
}) {
	const source = useAssetSource();
	const [failed, setFailed] = useState(false);
	const [paused, setPaused] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [media, setMedia] = useState<{ source: typeof source; path: string; video: string; audio: string } | null>(null);
	const movie = useRef<HTMLVideoElement>(null);
	const soundtrack = useRef<HTMLAudioElement>(null);
	const play = useRef<() => void>(() => {});
	const pausePlayback = useRef<() => void>(() => {});
	const handlers = useRef({ onReady, onEnded });
	handlers.current = { onReady, onEnded };
	useEffect(() => {
		const lease = acquireOpeningMedia(source);
		let active = true;
		const urls: string[] = [];
		setFailed(false);
		setPaused(false);
		setMedia(null);
		lease.load(path).then(pair => {
			if (!active) return;
			const video = URL.createObjectURL(pair.video);
			urls.push(video);
			const audio = URL.createObjectURL(pair.audio);
			urls.push(audio);
			setMedia({ source, path, video, audio });
		}).catch(() => { if (active) setFailed(true); });
		return () => { active = false; lease.dispose(); urls.forEach(url => URL.revokeObjectURL(url)); };
	}, [source, path, attempt]);
	const current = media?.source === source && media.path === path ? media : null;
	useEffect(() => {
		const video = movie.current;
		const audio = soundtrack.current;
		if (!video || !audio || !current || failed) return;
		let active = true;
		let announced = false;
		let ended = false;
		let blocked = false;
		let operation: AbortController | null = null;
		const stop = () => {
			operation?.abort();
			operation = null;
			video.pause();
			audio.pause();
		};
		const start = () => {
			if (!active || document.hidden || operation || video.readyState < 3 || audio.readyState < 3) return;
			const request = new AbortController();
			operation = request;
			void playMediaPair(video, audio, request.signal).then(() => {
				if (!active || request.signal.aborted) return;
				blocked = false;
				setPaused(false);
				if (!announced) { announced = true; handlers.current.onReady?.(); }
			}).catch(() => {
				if (!active || request.signal.aborted) return;
				blocked = true;
				setPaused(true);
			}).finally(() => { if (operation === request) operation = null; });
		};
		play.current = () => { blocked = false; start(); };
		pausePlayback.current = () => { blocked = true; stop(); setPaused(true); };
		const ready = () => {
			if (!blocked && ((video.paused && !video.ended) || (audio.paused && !audio.ended))) start();
		};
		const time = () => { if (!audio.paused && !video.ended && !audio.ended) synchronizeMediaClock(video, audio); };
		const seek = () => { if (!video.ended) synchronizeMediaClock(video, audio, true); };
		const pause = () => { if (!video.ended) { audio.pause(); setPaused(true); } };
		const audioPause = () => {
			if (!audio.ended && !video.paused) { video.pause(); setPaused(true); }
		};
		const wait = () => { stop(); if (active) setPaused(true); };
		const finish = () => {
			// Preserve a longer native soundtrack instead of truncating it at video end.
			if (announced && !ended && video.ended && audio.ended) { ended = true; handlers.current.onEnded?.(); }
		};
		const fail = () => { stop(); if (active) setFailed(true); };
		const visibility = () => { if (document.hidden) wait(); else ready(); };
		// Autoplay rejection must not leave an opening screen behind a visible recovery
		// control. Retry from the next gesture; preview mode keeps its own media control.
		const gesture = () => {
			if (presentation === "opening" && blocked) start();
		};
		video.addEventListener("canplay", ready);
		audio.addEventListener("canplay", ready);
		video.addEventListener("timeupdate", time);
		video.addEventListener("seeking", seek);
		video.addEventListener("ratechange", time);
		video.addEventListener("pause", pause);
		audio.addEventListener("pause", audioPause);
		video.addEventListener("waiting", wait);
		audio.addEventListener("waiting", wait);
		video.addEventListener("ended", finish);
		audio.addEventListener("ended", finish);
		video.addEventListener("error", fail);
		audio.addEventListener("error", fail);
		document.addEventListener("visibilitychange", visibility);
		window.addEventListener("pointerdown", gesture);
		window.addEventListener("keydown", gesture);
		ready();
		return () => {
			active = false;
			play.current = () => {};
			pausePlayback.current = () => {};
			video.removeEventListener("canplay", ready);
			audio.removeEventListener("canplay", ready);
			video.removeEventListener("timeupdate", time);
			video.removeEventListener("seeking", seek);
			video.removeEventListener("ratechange", time);
			video.removeEventListener("pause", pause);
			audio.removeEventListener("pause", audioPause);
			video.removeEventListener("waiting", wait);
			audio.removeEventListener("waiting", wait);
			video.removeEventListener("ended", finish);
			audio.removeEventListener("ended", finish);
			video.removeEventListener("error", fail);
			audio.removeEventListener("error", fail);
			document.removeEventListener("visibilitychange", visibility);
			window.removeEventListener("pointerdown", gesture);
			window.removeEventListener("keydown", gesture);
			stop();
		};
	}, [current, failed, presentation]);
	return <div className={presentation === "opening" ? "opening-native-movie" : "native-media-preview"}
		data-vfs-path={path} aria-busy={!current && !failed}>
		{current && !failed ? <><video ref={movie} src={current.video} muted playsInline preload="auto"
			style={presentation === "preview" ? { width: "100%", aspectRatio: "16/9", objectFit: "contain" } : undefined} />
			<audio ref={soundtrack} src={current.audio} preload="auto" /></> : failed ?
			<div role="alert">La vidéo ou sa bande-son n’est pas disponible. <button type="button"
				onClick={() => setAttempt(value => value + 1)}><GameText>Réessayer</GameText></button></div> : null}
		{presentation === "preview" && paused && !failed ? <button type="button" onClick={() => play.current()}>Lecture</button> : null}
		{presentation === "preview" && current && !paused && !failed ? <button type="button" onClick={() => pausePlayback.current()}><GameText>Pause</GameText></button> : null}
	</div>;
}
