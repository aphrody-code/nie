import { useAssetSource, useCapacites } from "@niers/inacord-ui";
import { NativeAudioPlayer, type NativeAudioManifest, type NativeAudioState } from "@niers/inacord-ui/lib/native-audio";
import { NATIVE_COMMAND_EVENT } from "@niers/inacord-ui/lib/native-command";
import { useEffect, useRef, useState } from "react";
import { NativeResources } from "./native-resources";

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
	}, [source, attempt, resourcesReady, started]);

	useEffect(() => { player.current?.setMusicEnabled(titleActive); }, [titleActive]);

	if (!titleActive || (audioState !== "blocked" && audioState !== "failed")) return null;
	return <button type="button" className="opening-audio-retry"
		onClick={() => audioState === "failed" ? setAttempt(value => value + 1) : player.current?.resume()}>
		{audioState === "failed" ? "Réessayer le son" : "Activer le son"}
	</button>;
}
