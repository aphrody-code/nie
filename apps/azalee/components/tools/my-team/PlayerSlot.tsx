"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@/components/ui/Icon";
import { SafeImage } from "@/components/ui/SafeImage";
import { ROLE_COLORS, ROLE_LABELS } from "@rosegriffon/azalee/game/formations";
import type { TeamMember } from "@rosegriffon/azalee/game/team-types";
import { cn } from "@/lib/utils";
import { getCharacterImageUrl } from "@rosegriffon/azalee/images";

interface PlayerSlotProps {
	member: TeamMember;
	onRemove: () => void;
	compact?: boolean;
}

export function PlayerSlot({ member, onRemove, compact }: PlayerSlotProps) {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		data: {
			member,
			origin: member.slot.startsWith("field-") ? "field" : "bench",
			slotId: member.slot,
			type: "player",
		},
		id: `placed-${member.slot}`,
	});

	const style = {
		opacity: isDragging ? 0.3 : 1,
		transform: CSS.Translate.toString(transform),
	};

	const roleColor = ROLE_COLORS[member.position] || ROLE_COLORS.MF;
	const roleLabel = ROLE_LABELS[member.position] || member.position;

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...listeners}
			{...attributes}
			className={cn(
				"group relative w-full h-full rounded-lg overflow-hidden cursor-grab active:cursor-grabbing",
				"bg-neutral-900",
				isDragging && "z-50"
			)}
		>
			{/* Character image */}
			<SafeImage
				src={member.imageUrl}
				zukanHash={member.zukanHash}
				fallbackSrc={member.internalCode ? getCharacterImageUrl(member.internalCode) : undefined}
				alt={member.name}
				fill
				sizes={compact ? "60px" : "100px"}
				className="object-cover"
				unoptimized
			/>

			{/* Bottom gradient */}
			<div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent" />

			{/* Role badge */}
			{!compact && (
				<span
					className="absolute top-0.5 left-0.5 sm:top-1 sm:left-1 text-[6px] sm:text-[8px] font-black px-1 py-px rounded text-white"
					style={{ backgroundColor: roleColor }}
				>
					{roleLabel}
				</span>
			)}

			{/* Name */}
			<span
				className={cn(
					"absolute bottom-0 inset-x-0 px-0.5 pb-0.5 text-white font-bold truncate drop-shadow-lg text-center",
					compact ? "text-xs sm:text-[7px]" : "text-xs sm:text-[9px]"
				)}
			>
				{member.name}
			</span>

			{/* Remove button — always visible on touch, hover on desktop */}
			<button
				onClick={(e) => {
					e.stopPropagation();
					onRemove();
				}}
				onPointerDown={(e) => e.stopPropagation()}
				className={cn(
					"no-export absolute top-0 right-0 p-1.5 sm:p-1 bg-red-600/90 rounded-bl-xl z-10 transition-opacity",
					"opacity-70 sm:opacity-0 sm:group-hover:opacity-100"
				)}
				aria-label={`Retirer ${member.name}`}
			>
				<Icon name="close" size={compact ? 10 : 12} className="text-white" />
			</button>
		</div>
	);
}

/* ── DragOverlay version (no interactivity) ──────────────── */

export function PlayerSlotOverlay({ member }: { member: TeamMember }) {
	const roleColor = ROLE_COLORS[member.position] || ROLE_COLORS.MF;
	const roleLabel = ROLE_LABELS[member.position] || member.position;

	return (
		<div className="w-20 h-24 sm:w-24 sm:h-28 rounded-lg overflow-hidden bg-neutral-900 shadow-2xl ring-2 ring-primary pointer-events-none">
			<div className="relative w-full h-full">
				<SafeImage
					src={member.imageUrl}
					zukanHash={member.zukanHash}
					fallbackSrc={member.internalCode ? getCharacterImageUrl(member.internalCode) : undefined}
					alt={member.name}
					fill
					sizes="100px"
					className="object-cover"
					unoptimized
				/>
				<div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent" />
				<span
					className="absolute top-1 left-1 text-[8px] font-black px-1 py-px rounded text-white"
					style={{ backgroundColor: roleColor }}
				>
					{roleLabel}
				</span>
				<span className="absolute bottom-0 inset-x-0 px-1 pb-1 text-white font-bold truncate drop-shadow-lg text-center text-[9px]">
					{member.name}
				</span>
			</div>
		</div>
	);
}
