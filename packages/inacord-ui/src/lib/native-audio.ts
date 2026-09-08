import { ResourceLoader, type AssetSource } from "@niers/asset-source";

export interface NativeAudioCue {
	bank: string;
	waveformBank: string;
	name: string;
	cueId: number;
	cueIndex: number;
	awbId: number | null;
	loop: boolean;
	streaming: boolean;
	lengthMs: number;
}

export interface NativeAudioManifest {
	schemaVersion: 1;
	title: NativeAudioCue;
	system: NativeAudioCue[];
	commands?: Array<{ objectPath: string; command: string; bank: string; cueName: string }>;
	unresolved: string[];
}

export type NativeAudioState = "loading" | "ready" | "playing" | "blocked" | "failed";

/** Host playback binding: cue identity and decoding remain owned by the native resource library. */
export class NativeAudioPlayer {
	private readonly resources = new ResourceLoader(3, 48 * 1024 * 1024);
	private readonly music = new Audio();
	private readonly effects = new Map<HTMLAudioElement, () => void>();
	private readonly urls = new Set<string>();
	private manifest: NativeAudioManifest | null = null;
	private disposed = false;
	private enabled = false;
	private hidden = false;
	private musicReady = false;
	private playbackVersion = 0;
	private loadVersion = 0;
	private effectEpoch = 0;
	private musicUrl: string | null = null;
	private volume = 1;

	constructor(private readonly source: Pick<AssetSource, "urlAudio">,
		private readonly changed: (state: NativeAudioState) => void) {
		this.music.preload = "auto";
		this.music.addEventListener("error", () => { if (!this.disposed) this.changed("failed"); });
	}

	async load(manifest: NativeAudioManifest): Promise<void> {
		const version = ++this.loadVersion;
		this.manifest = manifest;
		this.music.pause();
		this.musicReady = false;
		this.changed("loading");
		try {
			const blob = await this.resources.load(this.url(manifest.title));
			if (this.disposed || version !== this.loadVersion) return;
			if (this.musicUrl) { this.urls.delete(this.musicUrl); URL.revokeObjectURL(this.musicUrl); }
			this.musicUrl = this.objectUrl(blob);
			this.music.src = this.musicUrl;
			this.music.loop = manifest.title.loop;
			this.musicReady = true;
			this.changed("ready");
			this.resume();
		} catch {
			if (!this.disposed && version === this.loadVersion) this.changed("failed");
		}
		if (this.disposed || version !== this.loadVersion) return;
		// The bank contains voices as well as system cues. Only its native sy* cue family is
		// speculative startup audio; every other cue remains available through playCue on demand.
		const unique = new Map<string, NativeAudioCue>();
		for (const cue of manifest.system) {
			if (cue.name.startsWith("sy") && cue.awbId !== null) unique.set(this.url(cue), cue);
		}
		await Promise.allSettled([...unique.keys()].map((url) => this.resources.load(url, "preload")));
	}

	/** Title music follows its screen family; accepted UI effects remain independently playable. */
	setMusicEnabled(enabled: boolean) {
		this.enabled = enabled;
		this.playbackVersion++;
		if (!enabled) this.music.pause();
		else this.resume();
	}

	setHidden(hidden: boolean) {
		this.hidden = hidden;
		if (hidden) {
			this.effectEpoch++;
			this.playbackVersion++;
			this.music.pause();
			for (const release of this.effects.values()) release();
		} else this.resume();
	}

	setVolume(value: number) {
		if (!Number.isFinite(value)) return;
		this.volume = Math.min(1, Math.max(0, value));
		this.music.volume = this.volume;
		for (const effect of this.effects.keys()) effect.volume = this.volume;
	}

	/** Call synchronously from a trusted pointer/keyboard gesture when autoplay is blocked. */
	resume() {
		if (this.disposed || !this.enabled || this.hidden || !this.musicReady) return;
		const version = ++this.playbackVersion;
		void this.music.play().then(() => {
			if (!this.disposed && version === this.playbackVersion) this.changed("playing");
		}).catch((error: unknown) => {
			if (!this.disposed && version === this.playbackVersion) {
				this.changed(error instanceof DOMException && error.name === "NotAllowedError" ? "blocked" : "failed");
			}
		});
	}

	/** No guessed confirm/cancel alias: callers must provide an actual native bank/cue pair. */
	playCommand(objectPath: string, command: string): Promise<boolean> {
		const binding = this.manifest?.commands?.find(entry => entry.objectPath === objectPath && entry.command === command);
		return binding ? this.playCue(binding.bank, binding.cueName) : Promise.resolve(false);
	}

	async playCue(bank: string, name: string): Promise<boolean> {
		const epoch = this.effectEpoch;
		const cue = this.manifest?.system.find((entry) => entry.bank === bank && entry.name === name);
		if (!cue || this.disposed || this.hidden) return false;
		try {
			const blob = await this.resources.load(this.url(cue));
			if (this.disposed || this.hidden || epoch !== this.effectEpoch) return false;
			const url = this.objectUrl(blob);
			const audio = new Audio(url);
			audio.volume = this.volume;
			const release = () => {
				audio.pause();
				audio.removeAttribute("src");
				this.effects.delete(audio);
				this.urls.delete(url);
				URL.revokeObjectURL(url);
			};
			if (this.effects.size >= 16) this.effects.values().next().value?.();
			this.effects.set(audio, release);
			audio.addEventListener("ended", release, { once: true });
			audio.addEventListener("error", release, { once: true });
			try { await audio.play(); } catch { release(); return false; }
			return true;
		} catch { return false; }
	}

	private url(cue: NativeAudioCue): string {
		if (cue.awbId === null || !this.source.urlAudio) throw new Error("Native cue has no playable waveform");
		return this.source.urlAudio(cue.waveformBank, cue.awbId);
	}

	private objectUrl(blob: Blob): string {
		const url = URL.createObjectURL(blob);
		this.urls.add(url);
		return url;
	}

	dispose() {
		this.disposed = true;
		this.resources.dispose();
		this.music.pause();
		this.music.removeAttribute("src");
		for (const release of this.effects.values()) release();
		this.effects.clear();
		for (const url of this.urls) URL.revokeObjectURL(url);
		this.urls.clear();
	}
}
