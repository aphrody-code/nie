import { useAssetSource, useCapacites } from "@nie/inacord-ui";
import { NativeAudioPlayer, type NativeAudioManifest, type NativeAudioState } from "@nie/inacord-ui/lib/native-audio";
import { NATIVE_COMMAND_EVENT } from "@nie/inacord-ui/lib/native-command";
import { useEffect, useRef, useState } from "react";
import { NativeResources } from "./native-resources";
import { fetchJson } from "@nie/asset-source";

/** Persistent startup owner: decoding is native, host fetches are bounded and disposable. */
export function StartupResources({ titleActive }: { titleActive: boolean }) {
	const source = useAssetSource();
	const resourcesReady = useCapacites()?.vfs === true;
	const player = useRef<NativeAudioPlayer | null>(null);
	const [audioState, setAudioState] = useState<NativeAudioState>("loading");
	const [attempt, setAttempt] = useState(0);
	const [started, setStarted] = useState(titleActive);
	const active = useRef(titleActive);
	active.current = titleActive;
	useEffect(() => { if (titleActive) setStarted(true); }, [titleActive]);

	useEffect(() => {
		// Loading is reserved for VFS/database readiness. Audio starts only after the menu is
		// visible, so decoding cannot contend with the critical startup path.
		if (!resourcesReady || !started) return;
		const abort = new AbortController();
		const nativeResources = new NativeResources(source);
		let audio: NativeAudioPlayer;
		try { audio = new NativeAudioPlayer(source, setAudioState, (cue, priority) => nativeResources.audioCue(cue.bank, cue.name, priority)); }
		catch { nativeResources.dispose(); setAudioState("failed"); return; }
		player.current = audio;
		audio.setMusicEnabled(active.current);
		audio.setHidden(document.hidden);
		const resume = (event: Event) => { if (event.isTrusted) audio.resume(); };
		const visibility = () => audio.setHidden(document.hidden);
		const command = (event: WindowEventMap[typeof NATIVE_COMMAND_EVENT]) => {
			if (event.detail && typeof event.detail.objectPath === "string" && typeof event.detail.command === "string") {
				void audio.playCommand(event.detail.objectPath, event.detail.command);
			}
		};
		window.addEventListener("pointerdown", resume);
		window.addEventListener("keydown", resume);
		document.addEventListener("visibilitychange", visibility);
		window.addEventListener(NATIVE_COMMAND_EVENT, command);
		void fetchJson<NativeAudioManifest>("/api/v1/runtime/audio", {
			signal: abort.signal,
			timeoutMs: 15_000,
			retries: 2,
		}).then(async (manifest) => {
			if (manifest.schemaVersion !== 1 || !manifest.title || !Array.isArray(manifest.system)) {
				throw new Error("Invalid audio catalogue");
			}
			if (abort.signal.aborted) return;
			await audio.load(manifest);
			// Le geste de l'utilisateur a DÉJÀ eu lieu, et les écouteurs ci-dessus l'ont manqué.
			//
			// Ils ne sont posés qu'une fois le VFS prêt et le titre atteint — or on n'atteint le
			// titre qu'en cliquant ou en appuyant sur une touche. Ce clic-là est donc consommé
			// avant que quiconque l'écoute, et `AudioContext` reste suspendu jusqu'au geste
			// SUIVANT. Le bouton « Activer le son » ne servait qu'à fournir ce geste manquant.
			// `userActivation` dit si la page en a déjà reçu un : si oui, on reprend tout de
			// suite, et la musique du menu part sans que l'on ait à redemander quoi que ce soit.
			const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
			if (!abort.signal.aborted && activation?.hasBeenActive !== false) void audio.resume();
		}).catch(() => { if (!abort.signal.aborted) setAudioState("failed"); });
		return () => {
			abort.abort();
			window.removeEventListener("pointerdown", resume);
			window.removeEventListener("keydown", resume);
			document.removeEventListener("visibilitychange", visibility);
			window.removeEventListener(NATIVE_COMMAND_EVENT, command);
			audio.dispose();
			nativeResources.dispose();
			if (player.current === audio) player.current = null;
		};
	}, [source, attempt, resourcesReady, started]);

	useEffect(() => { player.current?.setMusicEnabled(titleActive); }, [titleActive]);

	// Une seule reprise, et seulement sur un ÉCHEC — `blocked` n'en est pas un, il attend un
	// geste. `attempt` est aussi la clé de l'effet de chargement : l'incrémenter relance tout.
	useEffect(() => {
		if (audioState !== "failed" || attempt > 0) return;
		const minuterie = window.setTimeout(() => setAttempt(1), 2_000);
		return () => window.clearTimeout(minuterie);
	}, [audioState, attempt]);

	// Aucun bouton. Le jeu n'en a pas, et celui-ci demandait à l'utilisateur de réparer une
	// mécanique du navigateur qu'il n'a pas à connaître : `blocked` se résout au premier geste,
	// que les écouteurs plus haut captent, et `userActivation` rattrape celui qui a précédé.
	//
	// `failed` reste distinct, et c'est pourquoi une seule reprise automatique subsiste : sans
	// elle, retirer le bouton rendrait un échec de chargement définitif pour la session. Une
	// seule — réessayer en boucle un catalogue absent martèlerait l'origine sans rien réparer.
	return null;
}
