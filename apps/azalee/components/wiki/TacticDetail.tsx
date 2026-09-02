"use client";

import { ArrowLeft, Flame, Hourglass, Map, Store, Timer, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { SHOP_FR, translateEffect } from "@rosegriffon/azalee/text/translations";

interface Tactic {
	slug: string;
	name: string;
	name_fr?: string;
	name_ja?: string;
	description_fr?: string | null;
	description_en?: string | null;
	description_ja?: string | null;
	effect1: string | null;
	effect2: string | null;
	effect3: string | null;
	duration: number | null;
	cooldown: number | null;
	shop: string | null;
	// Surface native de la table tactique (cf. wiki-service.getTactic).
	element?: string | null;
	power?: number | null;
	recastTime?: number | null;
	image?: string | null;
	imageUrl?: string | null;
}

interface TacticDetailProps {
	tactic: Tactic;
}

export function TacticDetail({ tactic }: TacticDetailProps) {
	const effects = [tactic.effect1, tactic.effect2, tactic.effect3].filter(Boolean) as string[];
	const shopFr = tactic.shop ? SHOP_FR[tactic.shop] || tactic.shop : null;
	const imageSrc = tactic.imageUrl || tactic.image;
	const [imgError, setImgError] = useState(false);

	return (
		<div className="w-full animate-in fade-in zoom-in-95 duration-300">
			{/* Back Button */}
			<div className="mb-4">
				<Link
					href="/tactic"
					className="inline-flex items-center gap-2 text-sm font-medium text-on-surface-variant hover:text-primary transition-colors"
				>
					<ArrowLeft size={20} aria-hidden="true" />
					Retour à la liste
				</Link>
			</div>

			{/* Main Card */}
			<div className="bg-surface-container-low border border-outline-variant/30 rounded-3xl overflow-hidden">
				{/* Header */}
				<div className="px-4 sm:px-6 pt-6 pb-4">
					<div className="flex items-start gap-4">
						<div className="w-full max-w-xs sm:max-w-sm shrink-0 rounded-2xl bg-surface-container-high flex items-center justify-center border border-outline-variant/20 overflow-hidden">
							{imageSrc && !imgError ? (
								<Image
									src={imageSrc}
									alt={tactic.name_fr || tactic.name}
									width={1728}
									height={352}
									sizes="(max-width: 640px) 100vw, 384px"
									className="w-full h-auto object-contain"
									unoptimized
									onError={() => setImgError(true)}
								/>
							) : (
								<Map size={30} className="text-primary" aria-hidden="true" />
							)}
						</div>
						<div className="flex-1 min-w-0">
							<h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-on-surface font-display">
								{tactic.name_fr || tactic.name}
							</h1>
							{tactic.name_fr && tactic.name_fr !== tactic.name && (
								<p className="text-sm text-on-surface-variant mt-0.5">{tactic.name}</p>
							)}
							{tactic.name_ja && (
								<p className="text-xs text-on-surface-variant/50 mt-0.5 font-light">
									{tactic.name_ja}
								</p>
							)}
							<div className="flex flex-wrap items-center gap-2 mt-2">
								<span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-tertiary/10 text-xs font-bold text-tertiary">
									<Map size={14} aria-hidden="true" />
									Tactique Spéciale
								</span>
								{/* Élément natif (table inagle_tactics, déjà en FR ; défaut 'Néant'). */}
								{tactic.element && tactic.element !== "Néant" && (
									<span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-xs font-bold text-primary">
										<Flame size={14} aria-hidden="true" />
										{tactic.element}
									</span>
								)}
							</div>
						</div>
					</div>
				</div>

				{/* Stats Row — masquée si aucune stat (sinon rangée fantôme bordée/paddée). */}
				{((tactic.power != null && tactic.power > 0) ||
					tactic.duration != null ||
					tactic.cooldown != null) && (
				<div className="px-4 sm:px-6 py-4 border-t border-outline-variant/20">
					<div className="flex flex-wrap gap-4">
						{tactic.power != null && tactic.power > 0 && (
							<div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant/20">
								<Flame size={20} className="text-primary" aria-hidden="true" />
								<div>
									<p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
										Puissance
									</p>
									<p className="text-sm font-black text-on-surface">{tactic.power}</p>
								</div>
							</div>
						)}
						{tactic.duration != null && (
							<div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant/20">
								<Timer size={20} className="text-tertiary" aria-hidden="true" />
								<div>
									<p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
										Durée
									</p>
									<p className="text-sm font-black text-on-surface">{tactic.duration}s</p>
								</div>
							</div>
						)}
						{tactic.cooldown != null && (
							<div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant/20">
								<Hourglass size={20} className="text-error" aria-hidden="true" />
								<div>
									<p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
										Recharge
									</p>
									<p className="text-sm font-black text-on-surface">{tactic.cooldown}s</p>
								</div>
							</div>
						)}
					</div>
				</div>
				)}

				{/* Description */}
				{tactic.description_fr && (
					<div className="px-4 sm:px-6 py-4 border-t border-outline-variant/20">
						<p className="text-sm text-on-surface-variant whitespace-pre-line leading-relaxed">
							{tactic.description_fr}
						</p>
						{tactic.description_ja && (
							<p className="text-xs text-on-surface-variant/50 mt-2 whitespace-pre-line leading-relaxed font-light">
								{tactic.description_ja}
							</p>
						)}
					</div>
				)}

				{/* Effects */}
				{effects.length > 0 && (
					<div className="px-4 sm:px-6 py-4 border-t border-outline-variant/20">
						<h2 className="text-xs uppercase tracking-wider text-on-surface-variant font-bold mb-3">
							<Zap size={16} className="inline align-middle mr-1" aria-hidden="true" />
							Effets
						</h2>
						<div className="space-y-2">
							{effects.map((effect, i) => (
								<div
									key={i}
									className="flex items-start gap-3 px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20"
								>
									<span className="size-6 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-black mt-0.5">
										{i + 1}
									</span>
									<div className="flex-1 min-w-0">
										<p className="text-sm font-medium text-on-surface">{translateEffect(effect)}</p>
										{translateEffect(effect) !== effect && (
											<p className="text-xs text-on-surface-variant mt-0.5">{effect}</p>
										)}
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Shop */}
				{shopFr && (
					<div className="px-4 sm:px-6 py-4 border-t border-outline-variant/20">
						<h2 className="text-xs uppercase tracking-wider text-on-surface-variant font-bold mb-3">
							<Store size={16} className="inline align-middle mr-1" aria-hidden="true" />
							Disponibilité
						</h2>
						<div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant/20">
							<Store size={20} className="text-primary" aria-hidden="true" />
							<span className="text-sm font-medium text-on-surface">{shopFr}</span>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
