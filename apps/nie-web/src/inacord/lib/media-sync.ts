/** Playback clock shared with Inacord's native movie player. Native packet offsets remain separate. */
export const MEDIA_DRIFT_LIMIT_SECONDS = 0.25;
const playbackOwners = new WeakMap<HTMLMediaElement, symbol>();

export function synchronizeMediaClock(video: HTMLMediaElement, audio: HTMLMediaElement, force = false): void {
	if (!Number.isFinite(video.currentTime) || audio.readyState < 1) return;
	if (force || Math.abs(audio.currentTime - video.currentTime) > MEDIA_DRIFT_LIMIT_SECONDS) {
		const target = Number.isFinite(audio.duration) ? Math.min(audio.duration, video.currentTime) : video.currentTime;
		audio.currentTime = Math.max(0, target);
	}
	audio.playbackRate = video.playbackRate;
}

/** Start both tracks in the same gesture. Cancellation, timeout or rejection stops both tracks. */
export async function playMediaPair(video: HTMLMediaElement, audio: HTMLMediaElement, signal?: AbortSignal): Promise<void> {
	const owner = Symbol("media-pair");
	playbackOwners.set(video, owner);
	playbackOwners.set(audio, owner);
	const pauseOwned = (media: HTMLMediaElement) => { if (playbackOwners.get(media) === owner) media.pause(); };
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let rejectStopped!: (error: Error) => void;
	const stop = (error: Error) => {
		stopped = true;
		pauseOwned(video);
		pauseOwned(audio);
		rejectStopped(error);
	};
	const aborted = () => stop(new Error("Media playback canceled"));
	const canceled = new Promise<never>((_, reject) => { rejectStopped = reject; });
	try {
		if (signal?.aborted) throw new Error("Media playback canceled");
		signal?.addEventListener("abort", aborted, { once: true });
		timer = setTimeout(() => stop(new Error("Media playback did not start")), 10_000);
		if (!video.ended && !audio.ended) synchronizeMediaClock(video, audio, true);
		// A late play resolution after cancellation must not resurrect either element.
		const track = async (media: HTMLMediaElement) => {
			if (media.ended) return;
			await media.play();
			if (stopped) pauseOwned(media);
		};
		await Promise.race([Promise.all([track(audio), track(video)]), canceled]);
	} catch (error) {
		stopped = true;
		pauseOwned(video);
		pauseOwned(audio);
		throw error;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		signal?.removeEventListener("abort", aborted);
	}
}
