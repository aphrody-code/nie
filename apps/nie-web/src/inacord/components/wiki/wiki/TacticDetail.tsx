"use client";

import { Flame, Hourglass, Map, Store, Timer, Zap } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface TacticDetailRecord {
	slug: string;
	name: string;
	localizedName?: string | null;
	secondaryName?: string | null;
	description?: string | null;
	secondaryDescription?: string | null;
	effects?: TacticDetailEffect[];
	shop?: string | null;
	element?: string | null;
	power?: number | null;
	duration?: number | null;
	cooldown?: number | null;
	image?: string | null;
}

export interface TacticDetailEffect {
	text: string;
	secondaryText?: string | null;
}

export interface TacticDetailImage {
	src: string;
	alt: string;
	onError: () => void;
}

export interface TacticDetailLabels {
	back: string;
	category: string;
	power: string;
	duration: string;
	cooldown: string;
	effects: string;
	availability: string;
}

export interface TacticDetailProps {
	tactic: TacticDetailRecord;
	labels: TacticDetailLabels;
	renderBackLink: (label: string) => ReactNode;
	renderImage?: (image: TacticDetailImage) => ReactNode;
}

/** Host-neutral tactic detail; hosts retain localized data, media and routing. */
export function TacticDetail({ tactic, labels, renderBackLink, renderImage }: TacticDetailProps) {
	const [imageFailed, setImageFailed] = useState(false);
	const displayName = tactic.localizedName || tactic.name;
	const hasStats = (tactic.power != null && tactic.power > 0) || tactic.duration != null || tactic.cooldown != null;
	const image = tactic.image && !imageFailed ? tactic.image : null;

	return <div className="w-full animate-in fade-in zoom-in-95 duration-300">
		<div className="mb-4">{renderBackLink(labels.back)}</div>
		<div className="bg-surface-container-low border border-outline-variant/30 rounded-3xl overflow-hidden">
			<div className="px-4 sm:px-6 pt-6 pb-4"><div className="flex items-start gap-4">
				<div className="w-full max-w-xs sm:max-w-sm shrink-0 rounded-2xl bg-surface-container-high flex items-center justify-center border border-outline-variant/20 overflow-hidden">
					{image && renderImage ? renderImage({ src: image, alt: displayName, onError: () => setImageFailed(true) }) : <Map size={30} className="text-primary" aria-hidden="true" />}
				</div>
				<div className="flex-1 min-w-0">
					<h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-on-surface font-display">{displayName}</h1>
					{tactic.localizedName && tactic.localizedName !== tactic.name && <p className="text-sm text-on-surface-variant mt-0.5">{tactic.name}</p>}
					{tactic.secondaryName && <p className="text-xs text-on-surface-variant/50 mt-0.5 font-light">{tactic.secondaryName}</p>}
					<div className="flex flex-wrap items-center gap-2 mt-2"><span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-tertiary/10 text-xs font-bold text-tertiary"><Map size={14} aria-hidden="true" />{labels.category}</span>{tactic.element && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-xs font-bold text-primary"><Flame size={14} aria-hidden="true" />{tactic.element}</span>}</div>
				</div>
			</div></div>
			{hasStats && <div className="px-4 sm:px-6 py-4 border-t border-outline-variant/20"><div className="flex flex-wrap gap-4">
				{tactic.power != null && tactic.power > 0 && <Stat icon={<Flame size={20} className="text-primary" aria-hidden="true" />} label={labels.power} value={tactic.power} />}
				{tactic.duration != null && <Stat icon={<Timer size={20} className="text-tertiary" aria-hidden="true" />} label={labels.duration} value={`${tactic.duration}s`} />}
				{tactic.cooldown != null && <Stat icon={<Hourglass size={20} className="text-error" aria-hidden="true" />} label={labels.cooldown} value={`${tactic.cooldown}s`} />}
			</div></div>}
			{tactic.description && <div className="px-4 sm:px-6 py-4 border-t border-outline-variant/20"><p className="text-sm text-on-surface-variant whitespace-pre-line leading-relaxed">{tactic.description}</p>{tactic.secondaryDescription && <p className="text-xs text-on-surface-variant/50 mt-2 whitespace-pre-line leading-relaxed font-light">{tactic.secondaryDescription}</p>}</div>}
			{tactic.effects && tactic.effects.length > 0 && <div className="px-4 sm:px-6 py-4 border-t border-outline-variant/20"><h2 className="text-xs uppercase tracking-wider text-on-surface-variant font-bold mb-3"><Zap size={16} className="inline align-middle mr-1" aria-hidden="true" />{labels.effects}</h2><div className="space-y-2">{tactic.effects.map((effect, index) => <Effect key={`${effect.text}-${index}`} number={index + 1} effect={effect} />)}</div></div>}
			{tactic.shop && <div className="px-4 sm:px-6 py-4 border-t border-outline-variant/20"><h2 className="text-xs uppercase tracking-wider text-on-surface-variant font-bold mb-3"><Store size={16} className="inline align-middle mr-1" aria-hidden="true" />{labels.availability}</h2><div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant/20"><Store size={20} className="text-primary" aria-hidden="true" /><span className="text-sm font-medium text-on-surface">{tactic.shop}</span></div></div>}
		</div>
	</div>;
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
	return <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant/20">{icon}<div><p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">{label}</p><p className="text-sm font-black text-on-surface">{value}</p></div></div>;
}

function Effect({ number, effect }: { number: number; effect: TacticDetailEffect }) {
	return <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20"><span className="size-6 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black mt-0.5">{number}</span><div className="flex-1 min-w-0"><p className="text-sm font-medium text-on-surface">{effect.text}</p>{effect.secondaryText && <p className="text-xs text-on-surface-variant mt-0.5">{effect.secondaryText}</p>}</div></div>;
}
