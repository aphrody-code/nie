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
	loopPoints?: { startSample: number; endSample: number; sampleRate: number } | null;
}

export interface NativeAudioManifest {
	schemaVersion: 1;
	title: NativeAudioCue;
	system: NativeAudioCue[];
	commands?: Array<{ objectPath: string; command: string; bank: string; cueName: string }>;
	unresolved: string[];
}

export type NativeAudioState = "loading" | "ready" | "playing" | "blocked" | "failed";
export type NativeCueLoader = (cue: NativeAudioCue, priority: "demand" | "preload") => Promise<Blob>;
export interface NativeAudioPreloadReport {
	status: "idle" | "loading" | "ready" | "failed" | "canceled";
	total: number; attempted: number; succeeded: number; failed: number;
	errors: Array<{ bank: string; cue: string; reason: string }>;
}

/** Native decoders supply PCM; this host binding schedules it at native loop sample boundaries. */
export class NativeAudioPlayer {
	private readonly resources = new ResourceLoader(3, 16 * 1024 * 1024);
	private readonly context = new AudioContext();
	private readonly gain = this.context.createGain();
	private readonly effects = new Set<AudioBufferSourceNode>();
	private readonly buffers = new Map<string, AudioBuffer>();
	private readonly pending = new Map<string, Promise<AudioBuffer>>();
	private readonly loadingNative = new Set<string>();
	private bufferBytes = 0;
	private manifest: NativeAudioManifest | null = null;
	private disposed = false;
	private musicEnabled = false;
	private hidden = false;
	private musicBuffer: AudioBuffer | null = null;
	private musicNode: AudioBufferSourceNode | null = null;
	private musicOffset = 0;
	private musicStartedAt = 0;
	private loadVersion = 0;
	private effectEpoch = 0;
	private resumePending: Promise<boolean> | null = null;
	private cancelResume: (() => void) | null = null;
	private preload: NativeAudioPreloadReport = { status: "idle", total: 0, attempted: 0, succeeded: 0, failed: 0, errors: [] };

	/** Separate from music state: successful title playback does not certify system cue coverage. */
	getPreloadReport(): NativeAudioPreloadReport {
		return { ...this.preload, errors: this.preload.errors.map(error => ({ ...error })) };
	}

	constructor(private readonly source: Pick<AssetSource, "urlAudio">,
		private readonly changed: (state: NativeAudioState) => void,
		private readonly nativeCueLoader?: NativeCueLoader) {
		this.gain.connect(this.context.destination);
		this.context.addEventListener("statechange", () => {
			if (this.disposed || this.hidden) return;
			if (this.context.state === "running") this.startMusic();
			else if (this.musicEnabled && this.musicBuffer) this.changed("blocked");
		});
	}

	async load(manifest: NativeAudioManifest): Promise<void> {
		const version = ++this.loadVersion;
		this.effectEpoch++;
		const cues = [...new Map(manifest.system.filter(cue => cue.name.startsWith("sy"))
			.map(cue => [cue.awbId === null ? `${cue.bank}#${cue.name}` : this.key(cue), cue])).values()];
		const report: NativeAudioPreloadReport = { status: "loading", total: cues.length, attempted: 0, succeeded: 0, failed: 0, errors: [] };
		this.preload = report;
		this.pauseMusic();
		this.manifest = manifest;
		this.musicBuffer = null;
		this.musicOffset = 0;
		this.changed("loading");
		try {
			const buffer = await this.buffer(manifest.title);
			if (this.disposed || version !== this.loadVersion) return;
			this.musicBuffer = buffer;
			this.changed("ready");
			if (this.musicEnabled) this.resume();
		} catch {
			if (!this.disposed && version === this.loadVersion) this.changed("failed");
		}
		if (this.disposed || version !== this.loadVersion) return;
		// Native sy* system cues preload; voices and other banks remain demand-loaded.
		let next = 0;
		await Promise.allSettled(Array.from({ length: 3 }, async () => {
			while (!this.disposed && version === this.loadVersion && next < cues.length) {
				const cue = cues[next++];
				if (cue) {
					report.attempted++;
					try { await this.buffer(cue, "preload"); report.succeeded++; }
					catch {
						report.failed++;
						report.errors.push({ bank: cue.bank, cue: cue.name, reason: "Native cue preload failed" });
					}
				}
			}
		}));
		report.status = this.disposed || version !== this.loadVersion ? "canceled"
			: report.failed || report.succeeded !== report.total || report.total === 0 ? "failed" : "ready";
	}

	/** Only title music follows screen membership; accepted interface effects remain independent. */
	setMusicEnabled(enabled: boolean) {
		this.musicEnabled = enabled;
		if (!enabled) this.pauseMusic();
		else this.resume();
	}

	setHidden(hidden: boolean) {
		this.hidden = hidden;
		if (hidden) {
			this.cancelResume?.();
			this.effectEpoch++;
			this.pauseMusic();
			for (const effect of this.effects) { effect.stop(); effect.disconnect(); }
			this.effects.clear();
			void this.context.suspend().catch(() => {});
		} else this.resume();
	}

	setVolume(value: number) {
		if (Number.isFinite(value)) this.gain.gain.value = Math.min(1, Math.max(0, value));
	}

	/** Invoke synchronously on a trusted user gesture, including before title music becomes active. */
	resume(): Promise<boolean> {
		if (this.disposed || this.hidden) return Promise.resolve(false);
		if (this.context.state === "running") { this.startMusic(); return Promise.resolve(true); }
		if (this.resumePending) return this.resumePending;
		if (this.musicEnabled && this.musicBuffer) this.changed("blocked");
		let settle!: (running: boolean) => void;
		const pending = new Promise<boolean>(resolve => { settle = resolve; });
		this.resumePending = pending;
		let finished = false;
		const finish = (running: boolean) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			this.resumePending = null;
			this.cancelResume = null;
			settle(running && !this.disposed && !this.hidden);
		};
		const timer = setTimeout(() => finish(false), 1000);
		this.cancelResume = () => finish(false);
		// Call resume synchronously within the gesture, but never await autoplay indefinitely.
		void this.context.resume().then(() => {
			if (!this.disposed && !this.hidden) this.startMusic();
			finish(this.context.state === "running");
		}).catch(() => {
			if (!this.disposed && !this.hidden) this.changed("failed");
			finish(false);
		});
		return pending;
	}

	playCommand(objectPath: string, command: string): Promise<boolean> {
		const binding = this.manifest?.commands?.find(entry => entry.objectPath === objectPath && entry.command === command);
		return binding ? this.playCue(binding.bank, binding.cueName) : Promise.resolve(false);
	}

	/** Effects play once, even when the bank declares a loop; no guessed button-to-cue aliases. */
	async playCue(bank: string, name: string): Promise<boolean> {
		const epoch = this.effectEpoch;
		const cue = this.manifest?.system.find(entry => entry.bank === bank && entry.name === name);
		if (!cue || this.disposed || this.hidden) return false;
		const resumed = this.resume();
		try {
			const [buffer, running] = await Promise.all([this.buffer(cue), resumed]);
			if (!running || this.disposed || this.hidden || epoch !== this.effectEpoch || this.context.state !== "running") return false;
			const effect = this.context.createBufferSource();
			effect.buffer = buffer;
			effect.connect(this.gain);
			if (this.effects.size >= 16) {
				const oldest = this.effects.values().next().value;
				if (oldest) { oldest.stop(); oldest.disconnect(); this.effects.delete(oldest); }
			}
			this.effects.add(effect);
			effect.onended = () => { effect.disconnect(); this.effects.delete(effect); };
			effect.start();
			return true;
		} catch { return false; }
	}

	private startMusic() {
		if (this.disposed || this.hidden || !this.musicEnabled || !this.musicBuffer || this.musicNode || this.context.state !== "running") return;
		const music = this.context.createBufferSource();
		music.buffer = this.musicBuffer;
		music.loop = this.manifest?.title.loop ?? false;
		const points = this.manifest?.title.loopPoints;
		if (points) {
			const start = points.startSample / points.sampleRate;
			const end = points.endSample / points.sampleRate;
			if (!(points.sampleRate > 0 && start >= 0 && end > start && end <= this.musicBuffer.duration + 1 / points.sampleRate)) {
				this.changed("failed");
				return;
			}
			music.loopStart = start;
			music.loopEnd = end;
		}
		music.connect(this.gain);
		music.onended = () => {
			music.disconnect();
			if (this.musicNode === music) { this.musicNode = null; this.musicOffset = 0; if (!this.disposed) this.changed("ready"); }
		};
		this.musicNode = music;
		this.musicStartedAt = this.context.currentTime;
		music.start(0, this.musicOffset);
		this.changed("playing");
	}

	private pauseMusic() {
		const music = this.musicNode;
		if (!music) return;
		this.musicOffset += Math.max(0, this.context.currentTime - this.musicStartedAt);
		const end = music.loopEnd || this.musicBuffer?.duration || 0;
		if (music.loop && end > music.loopStart && this.musicOffset >= end) {
			this.musicOffset = music.loopStart + (this.musicOffset - music.loopStart) % (end - music.loopStart);
		}
		this.musicNode = null;
		music.stop();
		music.disconnect();
	}

	private key(cue: NativeAudioCue) { return `${cue.waveformBank}#${cue.awbId}`; }

	private buffer(cue: NativeAudioCue, priority: "demand" | "preload" = "demand"): Promise<AudioBuffer> {
		if (this.disposed || cue.awbId === null) return Promise.reject(new Error("Native waveform unavailable"));
		const key = this.key(cue);
		const cached = this.buffers.get(key);
		if (cached) { this.buffers.delete(key); this.buffers.set(key, cached); return Promise.resolve(cached); }
		const pending = this.pending.get(key);
		if (pending) {
			if (priority === "demand" && this.loadingNative.has(key)) {
				// Both loaders deduplicate pending work while promoting its queued original bytes.
				const promoted = this.nativeCueLoader ? this.nativeCueLoader(cue, priority)
					: this.resources.load(this.source.urlAudio!(cue.waveformBank, cue.awbId), priority);
				void promoted.catch(() => {});
			}
			return pending;
		}
		const load = async () => {
			this.loadingNative.add(key);
			let blob: Blob;
			try {
				blob = this.nativeCueLoader ? await this.nativeCueLoader(cue, priority)
					: await this.resources.load(this.source.urlAudio!(cue.waveformBank, cue.awbId), priority);
			} finally { this.loadingNative.delete(key); }
			if (this.disposed) throw new Error("Audio player disposed");
			const buffer = await this.context.decodeAudioData(await blob.arrayBuffer());
			if (this.disposed) throw new Error("Audio player disposed");
			const bytes = buffer.length * buffer.numberOfChannels * 4;
			const budget = 48 * 1024 * 1024;
			if (bytes <= budget) {
				while (this.bufferBytes + bytes > budget) {
					const first = this.buffers.entries().next().value;
					if (!first) break;
					this.buffers.delete(first[0]);
					this.bufferBytes -= first[1].length * first[1].numberOfChannels * 4;
				}
				this.buffers.set(key, buffer);
				this.bufferBytes += bytes;
			}
			return buffer;
		};
		const promise = load().finally(() => this.pending.delete(key));
		this.pending.set(key, promise);
		return promise;
	}

	dispose() {
		this.disposed = true;
		this.cancelResume?.();
		if (this.preload.status === "loading") this.preload.status = "canceled";
		this.effectEpoch++;
		this.pauseMusic();
		this.resources.dispose();
		for (const effect of this.effects) { effect.stop(); effect.disconnect(); }
		this.effects.clear();
		this.buffers.clear();
		this.musicBuffer = null;
		this.gain.disconnect();
		void this.context.close().catch(() => {});
	}
}
