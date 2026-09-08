import { ResourceLoader, type AssetSource } from "@niers/asset-source";
import {
	audio_bank_json, audio_bank_cue_to_wav, g4tx_to_png, g4tx_named_to_png,
	vfs_content_summary, usm_metadata_json, usm_video_track_bytes,
	usm_audio_track_wav, usm_elementary_video_bytes,
} from "../wasm/nie_wasm.js";
import { ensureWasm } from "./bridge";

export interface NativeAudioCue {
	bank: string; waveformBank: string; name: string; awbId: number | null;
	streaming: boolean; loop: boolean; lengthMs: number; channels: number | null; sampleRate: number | null;
}
export interface NativeAudioBank { bank: string; cues: NativeAudioCue[] }
export interface NativeInspection {
	schemaVersion: number; path: string; recognized: boolean; lines: string[];
}
export interface NativeVideoMetadata {
	schemaVersion: number; originalName: string; fileName: string; sourceByteLength: number;
	video: {
		codec: string; byteLength: number; webMime: string | null;
		webRemuxSupported: boolean; unsupportedReason: string | null;
		frameRateNumerator: number; frameRateDenominator: number; durationSeconds: number;
	};
	audioTracks: Array<{
		channel: number; codec: string; sampleRate: number; channels: number;
		sampleCount: number; byteLength: number; durationSeconds: number | null;
		startOffsetSeconds: null;
	}>;
	playback: {
		webOutputContainsAudio: false; separateAudioRequired: boolean;
		externalSoundtrackResolved: false; perPacketTimestampsAvailable: false;
		synchronizedPlaybackProvided: false; timingSource: string;
	};
}
export interface NativeVideoTrack {
	originalPath: string; blob: Blob; metadata: NativeVideoMetadata;
}

/** Browser binding only: original VFS bytes enter the existing Rust format owners. */
export class NativeResources {
	private readonly loader: ResourceLoader;
	private readonly ownsLoader: boolean;
	private readonly retained = new Map<string, Uint8Array>();
	private readonly pending = new Map<string, Promise<Uint8Array>>();
	private readonly loadingSource = new Set<string>();
	private readonly pendingAudio = new Map<string, { promise: Promise<Blob>; priority: "demand" | "preload"; path: string }>();
	private readonly audioMetadata = new WeakMap<Uint8Array, NativeAudioBank>();
	private retainedBytes = 0;
	private disposed = false;

	constructor(private readonly source: Pick<AssetSource, "urlFichier">, loader?: ResourceLoader) {
		// Retain native byte arrays here, not a second copy of their input Blobs.
		this.loader = loader ?? new ResourceLoader(4, 0);
		this.ownsLoader = !loader;
	}

	private async bytes(path: string, priority: "demand" | "preload" = "demand"): Promise<Uint8Array> {
		if (this.disposed) throw new Error("Native resources disposed");
		const cached = this.retained.get(path);
		if (cached) {
			this.retained.delete(path);
			this.retained.set(path, cached);
			return cached;
		}
		const pending = this.pending.get(path);
		if (pending) {
			if (priority === "demand") this.promote(path);
			return pending;
		}
		const url = this.source.urlFichier(path);
		if (!url) throw new Error("Original resource URL is unavailable");
		const load = async () => {
			this.loadingSource.add(path);
			const original = this.loader.load(url, priority).finally(() => this.loadingSource.delete(path));
			const [blob] = await Promise.all([original, ensureWasm()]);
			const bytes = new Uint8Array(await blob.arrayBuffer());
			if (this.disposed) throw new Error("Native resources disposed");
			const budget = 64 * 1024 * 1024;
			if (bytes.byteLength <= budget) {
				while (this.retainedBytes + bytes.byteLength > budget) {
					const first = this.retained.entries().next().value;
					if (!first) break;
					this.retained.delete(first[0]);
					this.retainedBytes -= first[1].byteLength;
				}
				this.retained.set(path, bytes);
				this.retainedBytes += bytes.byteLength;
			}
			return bytes;
		};
		const request = load().finally(() => this.pending.delete(path));
		this.pending.set(path, request);
		return request;
	}

	private promote(path: string): void {
		if (this.loadingSource.has(path)) void this.loader.load(this.source.urlFichier(path), "demand").catch(() => {});
	}

	async audioBank(bank: string): Promise<NativeAudioBank> {
		return this.bankMetadata(bank, await this.bytes(bank));
	}

	private bankMetadata(bank: string, bytes: Uint8Array): NativeAudioBank {
		const cached = this.audioMetadata.get(bytes);
		if (cached) return cached;
		const metadata = JSON.parse(audio_bank_json(bank, bytes)) as NativeAudioBank;
		this.audioMetadata.set(bytes, metadata);
		return metadata;
	}

	/** Exact named cue, including native embedded/external AWB selection; no first-cue fallback. */
	audioCue(bank: string, name: string, priority: "demand" | "preload" = "demand"): Promise<Blob> {
		if (this.disposed) return Promise.reject(new Error("Native resources disposed"));
		const key = JSON.stringify([bank, name]);
		const pending = this.pendingAudio.get(key);
		if (pending) {
			if (priority === "demand") { pending.priority = priority; this.promote(pending.path); }
			return pending.promise;
		}
		let request!: { priority: "demand" | "preload"; path: string; promise: Promise<Blob> };
		const promise = Promise.resolve().then(() => this.decodeCue(bank, name, request))
			.finally(() => this.pendingAudio.delete(key));
		request = { priority, path: bank, promise };
		this.pendingAudio.set(key, request);
		return request.promise;
	}

	private async decodeCue(bank: string, name: string, request: { priority: "demand" | "preload"; path: string }): Promise<Blob> {
		const acb = await this.bytes(bank, request.priority);
		const metadata = this.bankMetadata(bank, acb);
		const matches = metadata.cues.filter(cue => cue.name === name);
		if (matches.length !== 1) throw new Error("Native cue is missing or ambiguous");
		const cue = matches[0]!;
		if (cue.awbId === null) throw new Error("Native cue waveform is unresolved");
		if (cue.streaming && (!cue.waveformBank || cue.waveformBank === bank)) {
			throw new Error("Native streaming waveform bank is unresolved");
		}
		request.path = cue.waveformBank;
		const external = cue.streaming ? await this.bytes(cue.waveformBank, request.priority) : new Uint8Array();
		return new Blob([new Uint8Array(audio_bank_cue_to_wav(acb, external, name))], { type: "audio/wav" });
	}

	async texture(path: string): Promise<Blob> {
		return new Blob([new Uint8Array(g4tx_to_png(await this.bytes(path)))], { type: "image/png" });
	}

	async textureRegion(path: string, region: string): Promise<Blob> {
		if (!region) throw new Error("A native named region is required");
		return new Blob([new Uint8Array(g4tx_named_to_png(await this.bytes(path), region))], { type: "image/png" });
	}

	async inspect(path: string): Promise<NativeInspection> {
		return JSON.parse(vfs_content_summary(path, await this.bytes(path))) as NativeInspection;
	}

	async videoMetadata(path: string): Promise<NativeVideoMetadata> {
		return JSON.parse(usm_metadata_json(path, await this.bytes(path))) as NativeVideoMetadata;
	}

	/** Video only. Separate audio offsets are unresolved; this is not synchronized movie playback. */
	async videoTrack(path: string): Promise<NativeVideoTrack> {
		const bytes = await this.bytes(path);
		const metadata = JSON.parse(usm_metadata_json(path, bytes)) as NativeVideoMetadata;
		if (!metadata.video.webRemuxSupported || !metadata.video.webMime) {
			throw new Error(metadata.video.unsupportedReason ?? "Native video remux is unsupported");
		}
		return { originalPath: path, metadata, blob: new Blob([
			new Uint8Array(usm_video_track_bytes(path, bytes)),
		], { type: metadata.video.webMime }) };
	}

	async audioTrack(path: string, channel: number): Promise<NativeVideoTrack> {
		if (!Number.isInteger(channel) || channel < 0 || channel > 255) throw new Error("Invalid native audio channel");
		const bytes = await this.bytes(path);
		const metadata = JSON.parse(usm_metadata_json(path, bytes)) as NativeVideoMetadata;
		return { originalPath: path, metadata, blob: new Blob([
			new Uint8Array(usm_audio_track_wav(path, bytes, channel)),
		], { type: "audio/wav" }) };
	}

	async elementaryVideo(path: string): Promise<{ originalPath: string; bytes: Uint8Array }> {
		return { originalPath: path, bytes: usm_elementary_video_bytes(path, await this.bytes(path)) };
	}

	dispose(): void {
		this.disposed = true;
		this.retained.clear();
		this.retainedBytes = 0;
		if (this.ownsLoader) this.loader.dispose();
	}
}
