import { ResourceLoader } from "@niers/asset-source";
import { useAssetSource, useCapacites } from "@niers/inacord-ui";
import { NativeAudioPlayer, type NativeAudioManifest, type NativeAudioState } from "@niers/inacord-ui/lib/native-audio";
import { NATIVE_COMMAND_EVENT } from "@niers/inacord-ui/lib/native-command";
import { nativeAssetUrl } from "@niers/inacord-ui/shell/native-title-menu";
import { useEffect, useRef, useState } from "react";
import { loadMenuPresentation } from "./bridge";
import { nativeTextRaster } from "./native-font";
import { NativeResources } from "./native-resources";
import { acquireOpeningMedia } from "./opening-media";
import { OPENING_LOGO_MOVIES } from "./opening-sequence";

/** Persistent startup owner: decoding is native, host fetches are bounded and disposable. */
export function StartupResources({ titleActive }: { titleActive: boolean }) {
	const source = useAssetSource();
	const resourcesReady = useCapacites()?.vfs === true;
	const player = useRef<NativeAudioPlayer | null>(null);
	const [audioState, setAudioState] = useState<NativeAudioState>("loading");
	const [attempt, setAttempt] = useState(0);
	const active = useRef(titleActive);
	active.current = titleActive;

	useEffect(() => {
		if (!resourcesReady) return;
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
		void fetch("/api/v1/runtime/audio", { signal: abort.signal }).then(async (response) => {
			if (!response.ok) throw new Error("Audio catalogue unavailable");
			const manifest = await response.json() as NativeAudioManifest;
			if (manifest.schemaVersion !== 1 || !manifest.title || !Array.isArray(manifest.system)) {
				throw new Error("Invalid audio catalogue");
			}
			if (!abort.signal.aborted) await audio.load(manifest);
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
	}, [source, attempt, resourcesReady]);

	useEffect(() => { player.current?.setMusicEnabled(titleActive); }, [titleActive]);

	useEffect(() => {
		if (!resourcesReady) return;
		const resources = new ResourceLoader(3, 0);
		const media = acquireOpeningMedia(source);
		let disposed = false;
		void Promise.allSettled(Object.values(OPENING_LOGO_MOVIES).map(path => media.load(path, "preload")));
		// Loading, notices and title share the existing Rust scene/font caches. Preload only
		// imminent surfaces; avatar, other menus and their models remain demand-loaded.
		void Promise.allSettled((["loading", "autosave", "start", "title-menu"] as const).map(async (id) => {
			const scene = await loadMenuPresentation(id);
			if (disposed) return;
			const urls = new Set<string>();
			for (const layer of scene.layers) {
				for (const region of [layer.region, layer.maskRegion, layer.focusedRegion]) {
					if (!region) continue;
					const url = nativeAssetUrl(source, layer.assetPath, region);
					if (url) urls.add(url);
				}
			}
			await Promise.allSettled([
				...[...urls].map((url) => resources.load(url, "preload")),
				...(scene.texts ?? []).map((text) => nativeTextRaster(source, text.text, ((text.color ?? 0xffffff) * 256 + 255) >>> 0)),
			]);
		}));
		return () => { disposed = true; resources.dispose(); media.dispose(); };
	}, [source, resourcesReady]);

	if (!titleActive || (audioState !== "blocked" && audioState !== "failed")) return null;
	return <button type="button" className="opening-audio-retry"
		onClick={() => audioState === "failed" ? setAttempt(value => value + 1) : player.current?.resume()}>
		{audioState === "failed" ? "Réessayer le son" : "Activer le son"}
	</button>;
}
