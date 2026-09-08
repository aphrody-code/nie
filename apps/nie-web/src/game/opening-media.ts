import { ResourceLoader, type AssetSource } from "@niers/asset-source";

type MediaSource = Pick<AssetSource, "urlVideo" | "urlVideoAudio">;
type Pool = { loader: ResourceLoader; users: number };
const pools = new WeakMap<MediaSource, Pool>();

/** Preload and mounted playback share decoded native media bytes, with bounded retention. */
export function acquireOpeningMedia(source: MediaSource) {
	let pool = pools.get(source);
	if (!pool) {
		pool = { loader: new ResourceLoader(2, 64 * 1024 * 1024), users: 0 };
		pools.set(source, pool);
	}
	pool.users++;
	const current = pool;
	let disposed = false;
	return {
		async load(path: string, priority: "demand" | "preload" = "demand") {
			if (disposed) throw new Error("Opening media lease disposed");
			const video = source.urlVideo?.(path);
			const audio = source.urlVideoAudio?.(path);
			if (!video || !audio) throw new Error("Original logo video or soundtrack is unavailable");
			const [videoBlob, audioBlob] = await Promise.all([
				current.loader.load(video, priority), current.loader.load(audio, priority),
			]);
			if (disposed) throw new Error("Opening media lease disposed");
			return { video: videoBlob, audio: audioBlob };
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			if (--current.users === 0) { current.loader.dispose(); pools.delete(source); }
		},
	};
}
