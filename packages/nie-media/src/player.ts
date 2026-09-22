export type MediaSource = {
	platform: "youtube" | "dailymotion";
	id: string;
	url?: string;
	official?: boolean;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/u;
const DAILYMOTION_ID = /(?:video\/|dm_)([A-Za-z0-9]+)/u;

export function sourceFromEpisode(videoId: string, thumbnail: string | null): MediaSource | null {
	if (YOUTUBE_ID.test(videoId)) return { platform: "youtube", id: videoId };
	const match = DAILYMOTION_ID.exec(thumbnail ?? "");
	if (match?.[1]) return { platform: "dailymotion", id: match[1] };
	return null;
}

export function sourcePlayerUrl(source: MediaSource, startSeconds?: number): string {
	const start = startSeconds && startSeconds > 0 ? `&start=${Math.floor(startSeconds)}` : "";
	if (source.platform === "youtube") {
		return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(source.id)}?rel=0${start}`;
	}
	return `https://geo.dailymotion.com/player/x/embed/video/${encodeURIComponent(source.id)}?sharing-enable=false${start}`;
}
