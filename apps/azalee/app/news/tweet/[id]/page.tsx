import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Calendar, ChevronLeft, Clock } from "lucide-react";
import { Twitter } from "@/lib/brand-icons";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPgPool } from "@/lib/db/pg";
import { getAuthorInfo } from "@/lib/author";

export const dynamic = "force-dynamic";

interface TweetMedia {
	type?: string;
	url?: string;
	video_url?: string;
	preview_url?: string;
	original_url?: string;
}

interface TweetRawTweet {
	id?: string;
	translation?: string;
	fullText?: string;
	text?: string;
	media?: TweetMedia[];
}

interface TweetRow {
	id: string;
	text: string | null;
	translation: string | null;
	author_id: string | null;
	author_username: string | null;
	author_name: string | null;
	category: string | null;
	created_at: string;
	is_thread: boolean | null;
	media: TweetMedia[] | null;
	metrics: Record<string, unknown> | null;
	quoted_tweets: unknown[] | null;
	raw_tweets: TweetRawTweet[] | null;
	tweet_count: number | null;
	updated_at: string | null;
}

type TweetMetaRow = Pick<
	TweetRow,
	"text" | "translation" | "author_username" | "author_name" | "media" | "raw_tweets"
>;

const AZALEE_USERNAME = "Azalee_IE";

async function getTweetMetaById(id: string): Promise<TweetMetaRow | null> {
	const pool = getPgPool();
	const { rows } = await pool.query<TweetMetaRow>(
		`SELECT text, translation, author_username, author_name, media, raw_tweets
		 FROM tweets
		 WHERE id = $1 AND author_username = $2
		 LIMIT 1`,
		[id, AZALEE_USERNAME]
	);
	return rows[0] ?? null;
}

async function getTweetMetaByThreadId(id: string): Promise<TweetMetaRow | null> {
	const pool = getPgPool();
	const { rows } = await pool.query<TweetMetaRow>(
		`SELECT text, translation, author_username, author_name, media, raw_tweets
		 FROM tweets
		 WHERE raw_tweets @> $1::jsonb AND author_username = $2
		 LIMIT 1`,
		[JSON.stringify([{ id }]), AZALEE_USERNAME]
	);
	return rows[0] ?? null;
}

async function getTweetById(id: string): Promise<TweetRow | null> {
	const pool = getPgPool();
	const { rows } = await pool.query<TweetRow>(
		`SELECT * FROM tweets WHERE id = $1 AND author_username = $2 LIMIT 1`,
		[id, AZALEE_USERNAME]
	);
	return rows[0] ?? null;
}

async function getTweetByThreadId(id: string): Promise<TweetRow | null> {
	const pool = getPgPool();
	const { rows } = await pool.query<TweetRow>(
		`SELECT * FROM tweets WHERE raw_tweets @> $1::jsonb AND author_username = $2 LIMIT 1`,
		[JSON.stringify([{ id }]), AZALEE_USERNAME]
	);
	return rows[0] ?? null;
}

function extractTitleAndBody(text: string): { title: string; body: string } {
	const paragraphs = text.split(/\n\n+/).filter(Boolean);
	const title = paragraphs[0]?.trim() || "";
	const body = paragraphs.slice(1).join("\n\n").trim();
	return { body, title };
}

function estimateReadTime(text: string): number {
	return Math.max(1, Math.ceil(text.trim().split(/\s+/).length / 200));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	let tweet = await getTweetMetaById(id);

	if (!tweet) {
		tweet = await getTweetMetaByThreadId(id);
	}

	const { title } = extractTitleAndBody(tweet?.translation || tweet?.text || "");
	const description = title.slice(0, 160);
	const image = tweet?.media?.[0]?.preview_url || tweet?.media?.[0]?.url;

	return {
		description,
		openGraph: {
			description,
			title: title.slice(0, 60),
			...(image && { images: [{ url: image }] }),
		},
		title: `${title.slice(0, 60)} | Azalée`,
		twitter: {
			card: "summary_large_image",
			creator: tweet?.author_username ? `@${tweet.author_username}` : "@Azalee_IE",
			site: tweet?.author_username ? `@${tweet.author_username}` : "@Azalee_IE",
		},
	};
}

/** Formats text links and escapes HTML entities for inline rendering */
function renderFormattedText(text: string) {
	if (!text) return null;

	const urlRegex = /(https?:\/\/[^\s]+)/g;
	const parts = text.split(urlRegex);

	return parts.map((part, i) => {
		if (urlRegex.test(part)) {
			let url = part;
			let suffix = "";
			if (/[.,;:]$/.test(url)) {
				suffix = url.slice(-1);
				url = url.slice(0, -1);
			}
			const isTwitterLink = url.includes("t.co");
			const displayUrl = isTwitterLink ? "Lien externe ↗" : url.replace(/^https?:\/\/(www\.)?/, "");

			return (
				<a
					key={i}
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-0.5 text-[#1DA1F2] hover:text-[#1DA1F2]/80 font-semibold underline decoration-wavy decoration-[#1DA1F2]/30 hover:decoration-[#1DA1F2] transition-all break-all"
				>
					{displayUrl}
					{suffix}
				</a>
			);
		}
		return part;
	});
}

/** Processes a tweet text block into beautifully styled paragraphs, lists, and subheadings */
function formatSectionText(text: string, isFirstSection = false) {
	if (!text) return null;

	// Strip trailing media URL short-links
	const cleanedText = text.replace(/https:\/\/t\.co\/[a-zA-Z0-9]+$/g, "").trim();
	if (!cleanedText) return null;

	const paragraphs = cleanedText.split(/\n+/).filter(Boolean);
	let hasRenderedDropCap = false;

	return (
		<div className="space-y-4">
			{paragraphs.map((p, index) => {
				const trimmed = p.trim();

				// Heading check: short and ending in a question mark or colon, or containing common transition phrases
				const isHeading =
					trimmed.length < 80 &&
					(trimmed.endsWith("?") ||
						trimmed.endsWith(":") ||
						trimmed.startsWith("Vient ensuite") ||
						trimmed.startsWith("C'en est fini") ||
						trimmed.startsWith("Parlons désormais") ||
						trimmed.startsWith("En vue de") ||
						trimmed.startsWith("Le tournoi se déroule"));

				// List item check
				const isListItem = trimmed.startsWith("-") || trimmed.startsWith("•");

				if (isHeading) {
					return (
						<h2
							key={index}
							className="text-xl sm:text-2xl font-normal font-cartoon text-on-surface mt-10 mb-5 pl-4 relative before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1.5 before:bg-[#1DA1F2] before:rounded-full"
						>
							{trimmed.replace(/^[-\s•]+/g, "")}
						</h2>
					);
				}

				if (isListItem) {
					return (
						<li
							key={index}
							className="list-none flex items-start gap-2.5 my-2 pl-2 text-on-surface-variant/90 leading-relaxed text-base sm:text-lg font-medium"
						>
							<span className="inline-flex size-2 rounded-full bg-[#1DA1F2]/50 mt-2.5 shrink-0 animate-pulse" />
							<span className="flex-1">
								{renderFormattedText(trimmed.replace(/^[-\s•]+/g, ""))}
							</span>
						</li>
					);
				}

				// Check for blockquote: if paragraph starts and ends with quotes
				const isBlockquote =
					(trimmed.startsWith("«") && trimmed.endsWith("»")) ||
					(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
					(trimmed.startsWith("“") && trimmed.endsWith("”"));

				if (isBlockquote) {
					const quoteText = trimmed.slice(1, -1).trim();
					return (
						<blockquote
							key={index}
							className="my-6 pl-5 border-l-4 border-[#1DA1F2]/60 italic text-on-surface/90 text-base sm:text-lg font-medium leading-[1.8] bg-[#1DA1F2]/5 py-4 pr-4 rounded-r-2xl"
						>
							{renderFormattedText(quoteText)}
						</blockquote>
					);
				}

				// Drop Cap for first letter of first paragraph
				if (isFirstSection && !hasRenderedDropCap && index === 0) {
					const firstChar = trimmed.charAt(0);
					const isLetter = /^[a-zA-ZÀ-ÿ]/.test(firstChar);
					if (isLetter) {
						hasRenderedDropCap = true;
						const restOfText = trimmed.slice(1);
						return (
							<p
								key={index}
								className="text-on-surface-variant/90 leading-[1.8] text-base sm:text-lg font-medium text-left"
							>
								<span className="float-left text-5xl sm:text-6xl font-cartoon mr-2 mt-1.5 text-primary leading-none select-none font-bold">
									{firstChar}
								</span>
								{renderFormattedText(restOfText)}
							</p>
						);
					}
				}

				return (
					<p
						key={index}
						className="text-on-surface-variant/90 leading-[1.8] text-base sm:text-lg font-medium text-left"
					>
						{renderFormattedText(trimmed)}
					</p>
				);
			})}
		</div>
	);
}

export default async function TweetPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	let tweet = await getTweetById(id);

	if (!tweet) {
		tweet = await getTweetByThreadId(id);
	}

	if (!tweet) {
		notFound();
	}

	const authorInfo = getAuthorInfo(tweet.author_username, tweet.author_name);

	const { title } = extractTitleAndBody(tweet.translation || tweet.text || "");
	const firstMedia = tweet.media?.[0];
	// Hero = miniature d'image. Si le 1er media est une vidéo (url = mp4),
	// on prend sa preview ; sinon pas de hero image (la vidéo sera rendue inline).
	const heroIsVideo = firstMedia?.type === "video" || !!firstMedia?.video_url;
	const heroImage = heroIsVideo ? firstMedia?.preview_url : firstMedia?.url;
	const readTime = estimateReadTime(tweet.translation || tweet.text || "");
	const isThread = tweet.is_thread && (tweet.tweet_count ?? 0) > 1;
	const publishedDate = tweet.created_at;

	const rawTweets: any[] = isThread && Array.isArray(tweet.raw_tweets) ? tweet.raw_tweets : [];

	interface Section {
		text: string;
		media: any[];
	}
	let sections: Section[] = [];

	if (rawTweets.length > 0) {
		// Thread
		sections = rawTweets.map((rt: any) => ({
			media: (rt.media || []).map((m: any) => {
				const downloaded = tweet.media?.find(
					(dm: any) => dm.original_url === m.url || dm.url === m.url
				);
				return downloaded || m;
			}),
			text: rt.translation || rt.fullText || rt.text || "",
		}));

		// Extract title part from the first tweet text to avoid duplication
		if (sections.length > 0) {
			const { body: firstTweetBody } = extractTitleAndBody(sections[0].text);
			sections[0] = { ...sections[0], text: firstTweetBody };
		}
	} else {
		// Single tweet
		const { body } = extractTitleAndBody(tweet.translation || tweet.text || "");
		if (body) {
			sections = [{ media: [], text: body }];
		}
		const remainingMedia = (tweet.media || []).slice(1);
		if (remainingMedia.length > 0 && sections.length > 0) {
			sections[0] = { ...sections[0], media: remainingMedia };
		} else if (remainingMedia.length > 0) {
			sections.push({ media: remainingMedia, text: "" });
		}
	}

	// Filter out the hero image from section media to avoid duplicate rendering
	if (sections.length > 0 && heroImage) {
		sections[0].media = sections[0].media.filter((m) => m.url !== heroImage);
	}

	return (
		<article className="min-h-screen bg-background animate-in fade-in duration-300">
			{/* ═══ HERO IMAGE ═══ */}
			<header className="relative">
				<div className="relative w-full aspect-[4/3] sm:aspect-[16/9] md:aspect-[21/9] bg-surface-container overflow-hidden">
					{heroImage ? (
						<Image
							src={heroImage}
							alt={title}
							fill
							className="object-cover scale-[1.01] blur-xs brightness-[0.95]"
							priority
							sizes="100vw"
						/>
					) : (
						<div className="absolute inset-0 bg-gradient-to-br from-[#1DA1F2]/20 via-surface-container to-primary/10" />
					)}
					{/* Gradient overlay */}
					<div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />

					{/* Back button */}
					<div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-20">
						<Link
							href="/news"
							className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs sm:text-sm font-semibold
                bg-black/40 hover:bg-black/60 border border-white/10 backdrop-blur-md text-white transition-all hover:scale-[1.02]"
						>
							<ChevronLeft className="size-4" />
							<span>Actualités</span>
						</Link>
					</div>
				</div>

				{/* ═══ FLOATING HEADER CARD ═══ */}
				<div className="relative -mt-24 sm:-mt-32 md:-mt-40 px-4 sm:px-6 md:px-8 max-w-[850px] mx-auto z-10">
					<div className="bg-surface-container/90 border border-outline-variant/15 backdrop-blur-xl rounded-3xl p-6 sm:p-8 md:p-10 shadow-2xl animate-in slide-in-from-bottom-8 duration-500">
						{/* Category & Badge */}
						<div className="flex flex-wrap items-center gap-2.5 mb-4">
							<span className="text-[10px] font-black uppercase tracking-widest text-[#1DA1F2]">
								Inazuma Eleven News
							</span>
							<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#1DA1F2] text-white shadow-sm shadow-[#1DA1F2]/20">
								<Twitter className="size-3 fill-current" />
								{isThread ? `Thread · ${tweet.tweet_count} tweets` : "Tweet"}
							</span>
						</div>

						{/* Title */}
						<h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-normal font-cartoon tracking-wide leading-[1.15] text-on-surface mb-5">
							{title}
						</h1>

						{/* Author & Meta */}
						<div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm text-on-surface-variant font-medium pt-3 border-t border-outline-variant/10">
							<div className="flex items-center gap-2">
								{authorInfo.avatar ? (
									<div className="size-8 sm:size-9 rounded-full bg-surface-container-high overflow-hidden relative shrink-0 ring-2 ring-background">
										<Image
											src={authorInfo.avatar}
											alt={authorInfo.name}
											fill
											sizes="36px"
											className="object-cover"
										/>
									</div>
								) : (
									<div
										className={`size-8 sm:size-9 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-background shrink-0 ${authorInfo.color}`}
									>
										{authorInfo.initials}
									</div>
								)}
								<div>
									<span className="font-bold text-on-surface block sm:inline">
										{authorInfo.name}
									</span>
									<span className="text-on-surface-variant/70 text-xs sm:ml-1.5">
										@{tweet.author_username}
									</span>
								</div>
							</div>

							<span className="text-on-surface-variant/20 hidden sm:inline">|</span>

							{/* Date */}
							<div className="flex items-center gap-1.5 text-on-surface-variant/80">
								<Calendar className="size-3.5" />
								<time dateTime={publishedDate}>
									{format(new Date(publishedDate), "d MMMM yyyy", { locale: fr })}
								</time>
							</div>

							<span className="text-on-surface-variant/20 hidden sm:inline">|</span>

							{/* Reading time */}
							<div className="flex items-center gap-1.5 text-on-surface-variant/80">
								<Clock className="size-3.5" />
								<span>{readTime} min de lecture</span>
							</div>
						</div>
					</div>
				</div>
			</header>

			{/* ═══ ARTICLE CONTENT ═══ */}
			<div className="px-4 sm:px-6 md:px-8 pt-8 pb-12 max-w-[850px] mx-auto">
				<div className="space-y-8">
					{sections.map((section, i) => {
						const formattedText = formatSectionText(section.text, i === 0);
						if (!formattedText && section.media.length === 0) return null;

						return (
							<div key={i} className="animate-in fade-in duration-300">
								{formattedText}

								{/* Section Media Grid */}
								{section.media.length > 0 && (
									<div
										className={`not-prose my-6 grid gap-4 ${
											section.media.length === 1 ? "grid-cols-1" : "grid-cols-2"
										}`}
									>
										{section.media.map((m: any, j: number) => {
											const videoSrc = m.video_url || (m.type === "video" ? m.url : undefined);
											const posterSrc = m.preview_url || (videoSrc ? undefined : m.url);
											return (
												<div
													key={j}
													className={`group relative overflow-hidden rounded-2xl border border-outline-variant/15 shadow-md bg-surface-container transition-all duration-300 hover:shadow-lg ${
														section.media.length === 1
															? "aspect-video"
															: section.media.length === 3 && j === 0
																? "col-span-2 aspect-video"
																: "aspect-square"
													}`}
												>
													{videoSrc ? (
														<video
															controls
															playsInline
															loop={m.type === "animated_gif"}
															muted={m.type === "animated_gif"}
															poster={posterSrc}
															preload="metadata"
															className="absolute inset-0 size-full object-cover"
														>
															<source src={videoSrc} type="video/mp4" />
														</video>
													) : (
														<>
															<Image
																src={m.url}
																alt=""
																fill
																className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
																sizes={section.media.length === 1 ? "850px" : "425px"}
															/>
															<div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
														</>
													)}
												</div>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>

				{/* ═══ PREMIUM PROFILE CARD FOOTER ═══ */}
				<div className="mt-12 p-6 rounded-3xl bg-surface-container border border-outline-variant/10 shadow-sm animate-in fade-in duration-500">
					<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
						<div className="flex items-center gap-4">
							{authorInfo.avatar ? (
								<div className="size-14 rounded-full bg-surface-container-high overflow-hidden relative border border-outline-variant/15 shrink-0 shadow-inner">
									<Image
										src={authorInfo.avatar}
										alt={authorInfo.name}
										fill
										className="object-cover"
									/>
								</div>
							) : (
								<div
									className={`size-14 rounded-full flex items-center justify-center text-white text-base font-bold border border-outline-variant/15 shrink-0 shadow-md ${authorInfo.color}`}
								>
									{authorInfo.initials}
								</div>
							)}
							<div>
								<div className="flex items-center gap-2">
									<p className="font-bold text-on-surface text-base sm:text-lg">
										{authorInfo.name}
									</p>
									<span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#1DA1F2]/10 text-[#1DA1F2]">
										Auteur
									</span>
								</div>
								<p className="text-sm text-on-surface-variant/60 font-medium">
									@{tweet.author_username}
								</p>
								<p className="text-xs sm:text-sm text-on-surface-variant/70 mt-1.5 max-w-[520px] leading-relaxed">
									{authorInfo.bio}
								</p>
							</div>
						</div>
						<a
							href={`https://x.com/${tweet.author_username}/status/${tweet.id}`}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-black dark:bg-white text-white dark:text-black text-sm font-bold hover:bg-black/80 dark:hover:bg-white/80 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-md shrink-0 w-full sm:w-auto"
						>
							<Twitter className="size-4 fill-current" />
							Voir sur X
						</a>
					</div>
				</div>
			</div>
		</article>
	);
}
