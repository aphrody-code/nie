"use client";

import Link from "next/link";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	Group as RKGroup,
	Image as RKImage,
	Layer as RKLayer,
	Rect as RKRect,
	Stage as RKStage,
	Text as RKText,
} from "react-konva";
import useImage from "use-image";

// React 19 / react-konva typings drift: cast each component once to FC<any>
// To bypass TS2604/TS2786. Runtime behavior is unchanged.
const Stage = RKStage as unknown as React.FC<any>;
const Layer = RKLayer as unknown as React.FC<any>;
const Rect = RKRect as unknown as React.FC<any>;
const Group = RKGroup as unknown as React.FC<any>;
const KonvaImage = RKImage as unknown as React.FC<any>;
const Text = RKText as unknown as React.FC<any>;
import { getCharacterImageUrl } from "@rosegriffon/azalee/images";
import { cn } from "@/lib/utils";

/* ── Constants ────────────────────────────────────────────── */

// Internal coordinate system — all drawing uses these coordinates
const DRAW_SIZE = 256;

const SPRITE_SRC = "/icon_common.webp";

const ELEMENT_SPRITE: Record<string, { x: number; y: number; width: number; height: number }> = {
	Fire: { height: 64, width: 64, x: 840, y: 1084 },
	Forest: { height: 64, width: 64, x: 496, y: 1088 },
	Mountain: { height: 64, width: 64, x: 772, y: 1084 },
	Wind: { height: 60, width: 60, x: 910, y: 1090 },
};

const PLAYSTYLE_SPRITE: Record<string, { x: number; y: number; width: number; height: number }> = {
	Bond: { height: 69, width: 80, x: 484, y: 396 },
	Breach: { height: 80, width: 78, x: 151, y: 408 },
	Counter: { height: 80, width: 76, x: 24, y: 408 },
	Justice: { height: 79, width: 68, x: 480, y: 144 },
	"Rough Play": { height: 64, width: 40, x: 752, y: 888 },
	Tension: { height: 48, width: 48, x: 476, y: 872 },
};

/* ── Colors ───────────────────────────────────────────────── */

const POS_COLORS: Record<string, string> = {
	DF: "rgb(59, 130, 246)",
	FW: "rgb(220, 38, 38)",
	GK: "rgb(217, 119, 6)",
	MF: "rgb(16, 185, 129)",
};

const POS_LABEL: Record<string, string> = {
	DF: "DEF",
	FW: "ATT",
	GK: "GAR",
	MF: "MIL",
};

/* ── Components ───────────────────────────────────────────── */

const FALLBACK_IMAGE = "/ie.webp";

const CharacterLayer = ({ imageUrl }: { imageUrl: string }) => {
	const [image, status] = useImage(imageUrl);
	const [fallback] = useImage(status === "failed" ? FALLBACK_IMAGE : "");
	const displayImage = status === "failed" ? fallback : image;
	if (!displayImage) {
		return null;
	}
	return <KonvaImage image={displayImage} x={0} y={0} width={DRAW_SIZE} height={DRAW_SIZE} />;
};

const BottomGradient = () => (
	<Rect
		y={DRAW_SIZE * 0.5}
		width={DRAW_SIZE}
		height={DRAW_SIZE * 0.5}
		fillLinearGradientStartPoint={{ x: 0, y: 0 }}
		fillLinearGradientEndPoint={{ x: 0, y: DRAW_SIZE * 0.5 }}
		fillLinearGradientColorStops={[0, "rgba(0,0,0,0)", 1, "rgba(0,0,0,0.75)"]}
	/>
);

const RARITY_CANVAS: Record<string, { bg: string; text: string; label: string }> = {
	BASARA: { bg: "rgb(219, 39, 119)", label: "BASARA", text: "rgb(255,255,255)" },
	HERO: { bg: "rgb(109, 40, 217)", label: "HÉROS", text: "rgb(196, 181, 253)" },
	N: { bg: "rgb(34, 197, 94)", label: "NORMAL", text: "rgb(187, 247, 208)" },
	R: { bg: "rgb(6, 182, 212)", label: "EXPÉRIMENTÉ", text: "rgb(165, 243, 252)" },
	SR: { bg: "rgb(59, 130, 246)", label: "ÉMÉRITE", text: "rgb(147, 197, 253)" },
	SSR: { bg: "rgb(109, 40, 217)", label: "HÉROS", text: "rgb(196, 181, 253)" },
};

const RarityBadge = ({ rarityKey }: { rarityKey: string }) => {
	const style = RARITY_CANVAS[rarityKey] || RARITY_CANVAS.N;
	const fontSize = 9;
	const h = 18;
	const totalW = style.label.length * 6 + 10;

	return (
		<Group x={8} y={8}>
			<Rect
				width={totalW}
				height={h}
				cornerRadius={4}
				fill={style.bg}
				opacity={0.85}
				shadowColor="rgba(0,0,0,0.4)"
				shadowBlur={4}
			/>
			<Text
				text={style.label}
				x={5}
				y={4}
				fontSize={fontSize}
				fontStyle="900"
				letterSpacing={1}
				fill={style.text}
				fontFamily="system-ui, -apple-system, sans-serif"
			/>
		</Group>
	);
};

const ElementPositionBadges = ({ element, position }: { element: string; position: string }) => {
	const [spriteSheet] = useImage(SPRITE_SRC);
	const elSprite = ELEMENT_SPRITE[element];
	const iconSize = 22;
	const posLabel = POS_LABEL[position] || position;
	const posColor = POS_COLORS[position] || POS_COLORS.MF;
	const badgeH = 18;
	const badgeW = 34;

	return (
		<Group x={8} y={DRAW_SIZE - 58}>
			{spriteSheet && elSprite && (
				<KonvaImage
					image={spriteSheet}
					crop={elSprite}
					x={0}
					y={0}
					width={iconSize}
					height={iconSize}
				/>
			)}
			<Group x={iconSize + 3} y={(iconSize - badgeH) / 2}>
				<Rect
					width={badgeW}
					height={badgeH}
					cornerRadius={4}
					fill={posColor}
					shadowColor="rgba(0,0,0,0.4)"
					shadowBlur={3}
				/>
				<Text
					text={posLabel}
					width={badgeW}
					y={4}
					align="center"
					fontSize={10}
					fontStyle="900"
					fill="white"
					fontFamily="system-ui, -apple-system, sans-serif"
				/>
			</Group>
		</Group>
	);
};

const PlaystyleIcons = ({ playstyles }: { playstyles?: string[] }) => {
	const [spriteSheet] = useImage(SPRITE_SRC);
	if (!playstyles || playstyles.length === 0 || !spriteSheet) {
		return null;
	}
	const iconSize = 20;
	return (
		<Group>
			{playstyles.map((ps, i) => {
				const sprite = PLAYSTYLE_SPRITE[ps];
				if (!sprite) {
					return null;
				}
				return (
					<KonvaImage
						key={ps}
						image={spriteSheet}
						crop={sprite}
						x={DRAW_SIZE - iconSize - 8}
						y={8 + i * (iconSize + 3)}
						width={iconSize}
						height={iconSize}
					/>
				);
			})}
		</Group>
	);
};

const NameBar = ({ name }: { name: string }) => (
	<Group x={8} y={DRAW_SIZE - 30}>
		<Text
			text={name}
			width={DRAW_SIZE - 16}
			fontSize={14}
			fontStyle="900"
			fill="white"
			fontFamily="system-ui, -apple-system, sans-serif"
			ellipsis
			wrap="none"
			shadowColor="rgba(0,0,0,0.8)"
			shadowBlur={4}
		/>
	</Group>
);

/* ── Main Component ───────────────────────────────────────── */

interface CharaCanvasCardProps {
	name: string;
	position: string;
	element: string;
	rarityKey: string;
	imageUrl: string;
	playstyle?: string;
	playstyles?: string[];
	href?: string;
	onClick?: () => void;
	className?: string;
}

export function CharaCanvasCard({
	name,
	position,
	element,
	rarityKey,
	imageUrl,
	playstyle,
	playstyles,
	href,
	onClick,
	className,
}: CharaCanvasCardProps) {
	const [containerWidth, setContainerWidth] = useState(0);
	const nodeRef = useRef<HTMLDivElement | null>(null);

	const measureRef = useCallback((node: HTMLDivElement | null) => {
		nodeRef.current = node;
		if (!node) {
			return;
		}
		const w = Math.round(node.getBoundingClientRect().width);
		if (w > 0) {
			setContainerWidth(w);
		}
	}, []);

	useEffect(() => {
		const node = nodeRef.current;
		if (!node) {
			return;
		}
		const ro = new ResizeObserver(([entry]) => {
			const w = Math.round(entry.contentRect.width);
			if (w > 0) {
				setContainerWidth(w);
			}
		});
		ro.observe(node);
		return () => ro.disconnect();
	}, []);

	const scale = containerWidth > 0 ? containerWidth / DRAW_SIZE : 1;
	// Cap at 2 to avoid excessive memory with thousands of cards
	const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

	const content = (
		<div ref={measureRef} className="w-full aspect-square overflow-hidden">
			{containerWidth > 0 && (
				<div style={{ pointerEvents: "none" }}>
					<Stage
						width={containerWidth}
						height={containerWidth}
						scaleX={scale}
						scaleY={scale}
						pixelRatio={dpr}
						listening={false}
					>
						<Layer>
							<Rect width={DRAW_SIZE} height={DRAW_SIZE} fill="#111" />
							<CharacterLayer imageUrl={imageUrl} />
							<BottomGradient />
							<RarityBadge rarityKey={rarityKey} />
							<PlaystyleIcons playstyles={playstyles || (playstyle ? [playstyle] : undefined)} />
							<ElementPositionBadges element={element} position={position} />
							<NameBar name={name} />
						</Layer>
					</Stage>
				</div>
			)}
		</div>
	);

	const containerClass = cn(
		"block overflow-hidden rounded-lg bg-neutral-900 relative",
		"transition-transform duration-150",
		"hover:-translate-y-0.5 active:scale-[0.97]",
		"border border-white/[0.06]",
		rarityKey === "BASARA" ? "ring-1 ring-amber-400/30" : "",
		rarityKey === "HERO" ? "ring-1 ring-violet-400/30" : "",
		className
	);

	if (href) {
		return (
			<Link href={href} className={containerClass} aria-label={name}>
				{content}
			</Link>
		);
	}

	return (
		<div
			onClick={onClick}
			role="button"
			tabIndex={0}
			aria-label={name}
			onKeyDown={(e) => {
				if ((e.key === "Enter" || e.key === " ") && onClick) {
					e.preventDefault();
					onClick();
				}
			}}
			className={containerClass}
		>
			{content}
		</div>
	);
}

/* ── Re-export for use in grid ───────────────────────────── */
export { getCharacterImageUrl };
