"use client";

import { CircleDot, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "../../ui/badge";
import { CommonSpriteIcon } from "../../ui/CommonSpriteIcon";
import type { SpriteCommonKey } from "../../../config/sprites-common";
import { Link } from "../../../compat/next";
import { cn } from "../../../lib/utils";

export interface AuraCardImage {
	src: string;
	alt: string;
	className: string;
	onError: () => void;
}

/**
 * The host owns image decoding and element artwork. Azalée keeps its Next/CDN
 * pipeline while Inacord keeps VFS thumbnail decoding; the card owns the UI.
 */
export interface AuraCardProps {
	id: string;
	name: string;
	element?: { en?: string; ja?: string; fr?: string };
	image?: string;
	assetCode?: string;
	subType?: string;
	category: string;
	passiveEffect?: string;
	hissatsuName?: string;
	className?: string;
	resolveImage?: (image: string | undefined, assetCode: string | undefined, subType: string) => string | null;
	renderImage?: (image: AuraCardImage) => ReactNode;
	renderElement?: (element: string) => ReactNode;
}

const SUBTYPE_COLORS: Record<string, string> = {
	Aura: "bg-blue-600/80 text-white",
	Awakening: "bg-secondary/80 text-on-secondary",
	Keshin: "bg-primary/80 text-on-primary",
	Miximax: "bg-primary/80 text-on-primary",
	ModeChange: "bg-error/80 text-white",
	Soul: "bg-tertiary/80 text-on-tertiary",
};

const SUBTYPE_LABELS: Record<string, string> = {
	Aura: "Aura",
	Awakening: "Éveil",
	Keshin: "Esprit Guerrier",
	Miximax: "Miximax",
	ModeChange: "Mode",
	Soul: "Totem",
};

const SUBTYPE_SPRITES: Record<string, SpriteCommonKey> = {
	Awakening: "eveil",
	Keshin: "keshin",
	Miximax: "miximax",
	ModeChange: "mode_change",
	Soul: "soul",
};

/** Shared Aura/Keshin/Soul card used by the Azalée and Inacord hosts. */
export function AuraCard({
	id,
	name,
	element,
	image,
	assetCode,
	subType = "Aura",
	category,
	passiveEffect,
	hissatsuName,
	className,
	resolveImage,
	renderImage,
	renderElement,
}: AuraCardProps) {
	const colorClass = SUBTYPE_COLORS[subType] || SUBTYPE_COLORS.Aura;
	const label = SUBTYPE_LABELS[subType] || subType;
	const [imgError, setImgError] = useState(false);
	const imageUrl = resolveImage?.(image, assetCode, subType) ?? image ?? null;

	return (
		<Link href={`/aura/${category}/${id}`} className={cn("block h-full", className)}>
			<div
				className={cn(
					"group relative flex flex-col rounded-xl overflow-hidden border transition-all duration-200",
					"hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98]",
					"bg-neutral-950 border-white/10 h-full"
				)}
			>
				<div className="relative w-full aspect-[16/9] overflow-hidden bg-neutral-900">
					{imageUrl && !imgError && renderImage ? (
						renderImage({
							src: imageUrl,
							alt: name,
							className: "object-contain group-hover:scale-105 transition-transform duration-300",
							onError: () => setImgError(true),
						})
					) : (
						<div className="absolute inset-0 flex items-center justify-center opacity-15">
							{SUBTYPE_SPRITES[subType] ? (
								<CommonSpriteIcon name={SUBTYPE_SPRITES[subType]} scale={0.7} />
							) : (
								<Sparkles size={48} className="text-white" aria-hidden="true" />
							)}
						</div>
					)}

					<div className="absolute top-1.5 left-1.5">
						<Badge
							className={cn(
								colorClass,
								"border-0 text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-sm leading-none"
							)}
						>
							{label}
						</Badge>
					</div>

					{element?.en && renderElement ? (
						<div className="absolute top-1.5 right-1.5 drop-shadow-lg">
							{renderElement(element.en)}
						</div>
					) : null}

					<div className="absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-neutral-950 to-transparent" />
				</div>

				<div className="px-3 py-2 flex flex-col gap-1 bg-neutral-950 grow">
					<h3 className="text-xs sm:text-sm font-bold text-white leading-tight line-clamp-2">{name}</h3>
					{passiveEffect && (
						<p className="text-[10px] text-tertiary/80 font-medium line-clamp-1">
							<Sparkles size={10} className="inline align-middle mr-0.5" aria-hidden="true" />
							{passiveEffect}
						</p>
					)}
					{hissatsuName && (
						<p className="text-[10px] text-primary/80 font-medium line-clamp-1">
							<CircleDot size={10} className="inline align-middle mr-0.5" aria-hidden="true" />
							{hissatsuName}
						</p>
					)}
				</div>
			</div>
		</Link>
	);
}
