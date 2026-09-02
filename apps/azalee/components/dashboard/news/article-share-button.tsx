"use client";

import { Check, Copy, Link2, Share2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import type { SharePlatform } from "@/app/actions/share-tracking";
import { trackShare } from "@/app/actions/share-tracking";
import { Popover, PopoverContent, PopoverTrigger } from "@rosegriffon/ui";
import { cn } from "@/lib/utils";

interface ArticleShareButtonProps {
	articleId?: string;
	title: string;
	description?: string;
	url?: string;
	imageUrl?: string;
	compact?: boolean;
}

interface Platform {
	id: SharePlatform | "reddit" | "discord" | "email";
	label: string;
	color: string;
	bgHover: string;
	icon: React.ReactNode;
	getUrl: (url: string, title: string, text: string) => string;
}

const PLATFORMS: Platform[] = [
	{
		bgHover: "hover:bg-[#1DA1F2]/10",
		color: "text-[#1DA1F2]",
		getUrl: (url, title) =>
			`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
		icon: (
			<svg viewBox="0 0 24 24" className="size-4 fill-current">
				<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
			</svg>
		),
		id: "twitter",
		label: "X",
	},
	{
		bgHover: "hover:bg-[#1877F2]/10",
		color: "text-[#1877F2]",
		getUrl: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
		icon: (
			<svg viewBox="0 0 24 24" className="size-4 fill-current">
				<path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
			</svg>
		),
		id: "facebook",
		label: "Facebook",
	},
	{
		bgHover: "hover:bg-[#25D366]/10",
		color: "text-[#25D366]",
		getUrl: (url, title) => `https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`,
		icon: (
			<svg viewBox="0 0 24 24" className="size-4 fill-current">
				<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
			</svg>
		),
		id: "whatsapp",
		label: "WhatsApp",
	},
	{
		bgHover: "hover:bg-[#0A66C2]/10",
		color: "text-[#0A66C2]",
		getUrl: (url) =>
			`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
		icon: (
			<svg viewBox="0 0 24 24" className="size-4 fill-current">
				<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
			</svg>
		),
		id: "linkedin",
		label: "LinkedIn",
	},
	{
		bgHover: "hover:bg-[#26A5E4]/10",
		color: "text-[#26A5E4]",
		getUrl: (url, title) =>
			`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
		icon: (
			<svg viewBox="0 0 24 24" className="size-4 fill-current">
				<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
			</svg>
		),
		id: "telegram",
		label: "Telegram",
	},
	{
		bgHover: "hover:bg-[#FF4500]/10",
		color: "text-[#FF4500]",
		getUrl: (url, title) =>
			`https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
		icon: (
			<svg viewBox="0 0 24 24" className="size-4 fill-current">
				<path d="M12 0C5.373 0 0 5.373 0 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-6.627-5.373-12-12-12zm6.066 13.71c.147.307.216.654.186 1.009a2.17 2.17 0 0 1-.594 1.347 3.822 3.822 0 0 1-1.313.928 7.26 7.26 0 0 1-1.778.55 10.593 10.593 0 0 1-2.065.211h-1.004c-.722 0-1.413-.072-2.065-.211a7.26 7.26 0 0 1-1.778-.55 3.822 3.822 0 0 1-1.313-.928 2.17 2.17 0 0 1-.594-1.347 2.018 2.018 0 0 1 .186-1.009c.132-.28.321-.531.556-.737a1.435 1.435 0 0 1-.093-.505 1.468 1.468 0 0 1 2.507-1.037 6.93 6.93 0 0 1 2.594-.514l1.305-3.047a.386.386 0 0 1 .461-.233l2.16.479a1.007 1.007 0 0 1 1.882.365 1.007 1.007 0 0 1-.871.998l-1.894-.42-1.154 2.692a6.93 6.93 0 0 1 2.461.508 1.468 1.468 0 0 1 2.507 1.037c0 .178-.033.35-.093.505.234.206.424.457.556.737zM9.5 13.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-4.5 2.25c.966.554 2.066.554 3 0a.375.375 0 1 0-.375-.65c-.69.396-1.56.396-2.25 0a.375.375 0 1 0-.375.65z" />
			</svg>
		),
		id: "reddit" as SharePlatform,
		label: "Reddit",
	},
	{
		bgHover: "hover:bg-surface-container-highest",
		color: "text-on-surface-variant",
		getUrl: (url, title, text) =>
			`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
		icon: (
			<svg
				viewBox="0 0 24 24"
				className="size-4 fill-none stroke-current"
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<rect width="20" height="16" x="2" y="4" rx="2" />
				<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
			</svg>
		),
		id: "email" as SharePlatform,
		label: "Email",
	},
];

export function ArticleShareButton({
	articleId,
	title,
	description,
	url,
	imageUrl,
	compact,
}: ArticleShareButtonProps) {
	const [copied, setCopied] = useState(false);
	const [shareCount, setShareCount] = useState(0);
	const [open, setOpen] = useState(false);
	const [justShared, setJustShared] = useState<string | null>(null);
	const [, startTransition] = useTransition();
	const [isMobileShare] = useState(
		() => typeof navigator !== "undefined" && typeof navigator.share === "function"
	);

	const shareUrl = url || (typeof window !== "undefined" ? window.location.href : "");
	const shareText = description || title;

	// Fetch share count on mount
	useEffect(() => {
		if (!articleId) {
			return;
		}
		// Use the articles table share_count (fast, denormalized)
		fetch(`/api/news/share-count?id=${articleId}`)
			.then((r) => r.json())
			.then((d) => {
				if (d.count) {
					setShareCount(d.count);
				}
			})
			.catch(() => {});
	}, [articleId]);

	const track = useCallback(
		(platform: SharePlatform) => {
			if (!articleId) {
				return;
			}
			setShareCount((c) => c + 1);
			startTransition(async () => {
				try {
					await trackShare(articleId, platform);
				} catch {
					// Silent
				}
			});
		},
		[articleId]
	);

	const handlePlatformShare = (platform: Platform) => {
		const shareTarget = platform.getUrl(shareUrl, title, shareText);
		if (platform.id === "email") {
			window.location.href = shareTarget;
		} else {
			window.open(shareTarget, "_blank", "noopener,noreferrer,width=600,height=500");
		}
		track(platform.id as SharePlatform);
		setJustShared(platform.id);
		setTimeout(() => setJustShared(null), 2000);
	};

	const handleCopyLink = async () => {
		try {
			await navigator.clipboard.writeText(shareUrl);
			setCopied(true);
			toast.success("Lien copié !");
			track("copy");
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error("Impossible de copier le lien");
		}
	};

	const handleNativeShare = async () => {
		try {
			await navigator.share({ text: shareText, title, url: shareUrl });
			track("native");
		} catch {
			// User cancelled
		}
	};

	// Compact variant: just an icon button
	if (compact) {
		if (isMobileShare) {
			return (
				<button
					onClick={handleNativeShare}
					className="inline-flex items-center gap-1 px-2 py-1.5 rounded-full text-xs text-on-surface-variant hover:text-primary transition-colors"
				>
					<Share2 className="size-4" />
				</button>
			);
		}
		return (
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button className="inline-flex items-center gap-1 px-2 py-1.5 rounded-full text-xs text-on-surface-variant hover:text-primary transition-colors">
						<Share2 className="size-4" />
					</button>
				</PopoverTrigger>
				<PopoverContent
					className="w-64 p-0 rounded-2xl bg-surface-container border border-outline-variant/20 shadow-2xl"
					align="end"
					sideOffset={8}
				>
					<SharePopoverContent
						platforms={PLATFORMS}
						onPlatformShare={handlePlatformShare}
						onCopyLink={handleCopyLink}
						copied={copied}
						justShared={justShared}
					/>
				</PopoverContent>
			</Popover>
		);
	}

	// Mobile native share
	if (isMobileShare) {
		return (
			<button
				onClick={handleNativeShare}
				className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium
          bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface transition-all"
			>
				<Share2 className="size-4" />
				Partager
				{shareCount > 0 && (
					<span className="text-xs text-on-surface-variant/60 tabular-nums">{shareCount}</span>
				)}
			</button>
		);
	}

	// Desktop: full popover
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium
            bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface transition-all"
				>
					<Share2 className="size-4" />
					Partager
					{shareCount > 0 && (
						<span className="text-xs text-on-surface-variant/60 tabular-nums">{shareCount}</span>
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent
				className="w-80 p-0 rounded-2xl bg-surface-container border border-outline-variant/20 shadow-2xl overflow-hidden"
				align="start"
				sideOffset={8}
			>
				{/* Link preview card */}
				{imageUrl && (
					<div className="relative h-32 bg-surface-container-high overflow-hidden">
						<Image src={imageUrl} alt={title} fill sizes="320px" className="object-cover" />
						<div className="absolute inset-0 bg-linear-to-t from-surface-container to-transparent" />
						<div className="absolute bottom-2 left-3 right-3">
							<p className="text-xs font-bold text-on-surface line-clamp-2 drop-shadow">{title}</p>
						</div>
					</div>
				)}

				{/* URL bar */}
				<div className="px-3 pt-3 pb-2">
					<div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container-low border border-outline-variant/10">
						<Link2 className="size-3.5 text-on-surface-variant/40 shrink-0" />
						<span className="text-xs text-on-surface-variant/60 truncate flex-1">
							{shareUrl.replace(/^https?:\/\//, "")}
						</span>
						<button
							onClick={handleCopyLink}
							className={cn(
								"shrink-0 p-1 rounded-lg transition-colors",
								copied ? "text-green-500" : "text-on-surface-variant/50 hover:text-on-surface"
							)}
						>
							{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
						</button>
					</div>
				</div>

				<SharePopoverContent
					platforms={PLATFORMS}
					onPlatformShare={handlePlatformShare}
					onCopyLink={handleCopyLink}
					copied={copied}
					justShared={justShared}
				/>

				{/* Share count footer */}
				{shareCount > 0 && (
					<div className="px-3 pb-3 pt-1">
						<p className="text-[10px] text-on-surface-variant/40 text-center">
							Partagé {shareCount} fois
						</p>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

function SharePopoverContent({
	platforms,
	onPlatformShare,
	onCopyLink,
	copied,
	justShared,
}: {
	platforms: Platform[];
	onPlatformShare: (p: Platform) => void;
	onCopyLink: () => void;
	copied: boolean;
	justShared: string | null;
}) {
	return (
		<div className="p-3">
			<p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-2 px-1">
				Partager via
			</p>
			<div className="grid grid-cols-4 gap-1.5">
				{platforms.map((p) => (
					<button
						key={p.id}
						onClick={() => onPlatformShare(p)}
						className={cn(
							"flex flex-col items-center gap-1.5 p-2.5 rounded-xl transition-all",
							"text-on-surface-variant hover:text-on-surface",
							p.bgHover,
							justShared === p.id && "ring-2 ring-primary/30 bg-primary/5"
						)}
						title={p.label}
					>
						<div
							className={cn("transition-colors", justShared === p.id ? "text-primary" : p.color)}
						>
							{justShared === p.id ? <Check className="size-4" /> : p.icon}
						</div>
						<span className="text-[10px] font-medium leading-none">{p.label}</span>
					</button>
				))}
			</div>

			<div className="mt-2 pt-2 border-t border-outline-variant/10">
				<button
					onClick={onCopyLink}
					className={cn(
						"flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm font-medium transition-all",
						copied
							? "text-green-500 bg-green-500/5"
							: "text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
					)}
				>
					{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
					{copied ? "Lien copié !" : "Copier le lien"}
				</button>
			</div>
		</div>
	);
}
