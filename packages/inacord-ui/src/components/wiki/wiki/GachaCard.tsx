"use client";

import { Gift, Shirt } from "lucide-react";
import { Link } from "../../../compat/next";
import { cn } from "../../../lib/utils";

export interface CapsulePrizeCard {
	id: string;
	contentRef: string;
	poolRef: string;
}

export interface CostumeCardData {
	index: number;
	type: number;
	typeLabel: string;
	modelRef: string;
	flag1: number;
	flag2: number;
}

export interface CapsuleCardProps {
	prize: CapsulePrizeCard;
	className?: string;
	href?: string;
	labels?: Partial<{ lot: string; content: string; pool: string }>;
}

/** Shared capsule prize card. The caller owns database/VFS resolution. */
export function CapsuleCard({ prize, className, href = `/capsule/${prize.id}`, labels }: CapsuleCardProps) {
	const text = { lot: "Lot", content: "Contenu", pool: "Pool", ...labels };
	return (
		<Link href={href} className={cn("group flex h-full flex-col gap-2 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4 transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-container hover:shadow-lg", className)}>
			<div className="flex items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Gift size={20} aria-hidden="true" /></span><div className="min-w-0"><span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">{text.lot}</span><h3 className="truncate font-mono text-sm font-bold leading-tight text-on-surface transition-colors group-hover:text-primary">{prize.id}</h3></div></div>
			<div className="mt-auto space-y-1 text-xs"><div className="flex items-center justify-between gap-2"><span className="text-on-surface-variant/70">{text.content}</span><span className="truncate font-mono text-on-surface-variant">{prize.contentRef}</span></div><div className="flex items-center justify-between gap-2"><span className="text-on-surface-variant/70">{text.pool}</span><span className="truncate font-mono text-on-surface-variant">{prize.poolRef}</span></div></div>
		</Link>
	);
}

export interface CostumeCardProps { costume: CostumeCardData; className?: string; label?: (index: number) => string; }

/** Shared costume card which intentionally presents model identifiers when no artwork is resolved. */
export function CostumeCard({ costume, className, label = (index) => `Costume #${index}` }: CostumeCardProps) {
	const typeColor = costume.type === 0 ? "bg-slate-500/15 text-slate-500" : costume.type === 1 ? "bg-blue-500/15 text-blue-600" : "bg-purple-500/15 text-purple-600";
	return (
		<div className={cn("flex h-full flex-col gap-2 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4 transition-colors duration-200 hover:bg-surface-container", className)}>
			<div className="flex items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-tertiary/10 text-tertiary"><Shirt size={20} aria-hidden="true" /></span><div className="min-w-0"><span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">{label(costume.index)}</span><h3 className="truncate font-mono text-sm font-bold leading-tight text-on-surface">{costume.modelRef}</h3></div></div>
			<div className="mt-auto flex flex-wrap items-center gap-1.5"><span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", typeColor)}>{costume.typeLabel}</span>{(costume.flag1 !== 0 || costume.flag2 !== 0) ? <span className="inline-flex items-center rounded-full bg-surface-container-highest px-2 py-0.5 font-mono text-[10px] text-on-surface-variant/70">{costume.flag1 !== 0 ? `f1:${costume.flag1}` : ""}{costume.flag1 !== 0 && costume.flag2 !== 0 ? " " : ""}{costume.flag2 !== 0 ? `f2:${costume.flag2}` : ""}</span> : null}</div>
		</div>
	);
}
