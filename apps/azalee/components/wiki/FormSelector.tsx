"use client";

import NextImage from "next/image";
import NextLink from "next/link";
import { SafeImage } from "@/components/ui/SafeImage";
import { getCharacterFaceUrl, getSkillElementIconUrl } from "@rosegriffon/azalee/images";
import { cn } from "@/lib/utils";

interface FormSelectorForm {
	id: string;
	slug: string;
	position: string;
	element: string;
	rarity: string;
	zukanHash?: string;
	internalCode?: string;
	heroType?: string;
}

interface FormSelectorProps {
	forms: FormSelectorForm[];
	currentFormId?: string;
}

const POSITION_MAP: Record<string, string> = {
	ATT: "ATT",
	DEF: "DEF",
	DF: "DEF",
	FW: "ATT",
	GAR: "GAR",
	GK: "GAR",
	MF: "MIL",
	MIL: "MIL",
};

const POSITION_FR: Record<string, string> = {
	ATT: "Attaquant",
	DEF: "Defenseur",
	GAR: "Gardien",
	MIL: "Milieu",
};

const ELEMENT_FR: Record<string, string> = {
	Fire: "Feu",
	Forest: "Foret",
	Mountain: "Montagne",
	Void: "Neant",
	Wind: "Vent",
};

export function FormSelector({ forms, currentFormId }: FormSelectorProps) {
	if (!forms || forms.length <= 1) {
		return null;
	}

	return (
		<div className="space-y-1.5 text-center sm:text-left w-full">
			<span className="text-[10px] font-black uppercase tracking-widest text-white/40 block">
				Formes
			</span>
			<div className="flex items-center justify-center sm:justify-start gap-2 overflow-x-auto pb-1 scrollbar-none w-full">
				{forms.map((form) => {
					const isCurrent = form.id === currentFormId;
					const pos = POSITION_MAP[form.position] || form.position;
					const posLabel = POSITION_FR[pos] || pos;
					const elemLabel = ELEMENT_FR[form.element] || form.element;
					const elemIcon = getSkillElementIconUrl(form.element);

					// Build image URL: zukanHash > internalCode face > fallback
					let imageUrl = "/ievr.webp";
					if (form.zukanHash) {
						imageUrl = `https://dxi4wb638ujep.cloudfront.net/1/${form.zukanHash}.png`;
					} else if (form.internalCode) {
						imageUrl = getCharacterFaceUrl(form.internalCode);
					}

					const isBasara = form.rarity === "BASARA";
					const isHero = form.rarity === "Héros";

					return (
						<NextLink
							key={form.id}
							href={`/chara/${form.slug}`}
							className={cn(
								"relative shrink-0 rounded-xl overflow-hidden transition-all group",
								"size-14 sm:w-[56px] sm:h-[56px]",
								isCurrent
									? "ring-2 ring-primary shadow-lg shadow-primary/20 opacity-100"
									: "opacity-70 hover:opacity-100 ring-1 ring-white/20 hover:ring-white/40",
								isBasara && !isCurrent && "ring-purple-400/40",
								isBasara && isCurrent && "ring-2 ring-purple-400 shadow-purple-500/30",
								isHero && !isCurrent && form.heroType === "fire" && "ring-red-400/40",
								isHero &&
									isCurrent &&
									form.heroType === "fire" &&
									"ring-2 ring-red-400 shadow-red-500/30",
								isHero && !isCurrent && form.heroType === "black" && "ring-gray-500/40",
								isHero &&
									isCurrent &&
									form.heroType === "black" &&
									"ring-2 ring-gray-500 shadow-gray-500/30",
								isHero && !isCurrent && form.heroType === "pink" && "ring-pink-400/40",
								isHero &&
									isCurrent &&
									form.heroType === "pink" &&
									"ring-2 ring-pink-400 shadow-pink-500/30",
								isHero && !isCurrent && !form.heroType && "ring-amber-400/40",
								isHero && isCurrent && !form.heroType && "ring-2 ring-amber-400 shadow-amber-500/30"
							)}
							title={(() => {
								const heroLabels: Record<string, string> = {
									black: "Ombre",
									fire: "Feu",
									pink: "Rose",
								};
								const heroSuffix = form.heroType
									? ` ${heroLabels[form.heroType] || form.heroType}`
									: "";
								const raritySuffix =
									form.rarity !== "Normal" ? ` (${form.rarity}${heroSuffix})` : "";
								return `${posLabel} ${elemLabel}${raritySuffix}`;
							})()}
						>
							{/* Portrait */}
							<div className="absolute inset-0 bg-black/40">
								<SafeImage
									src={imageUrl}
									zukanHash={form.zukanHash}
									fallbackSrc={form.internalCode ? getCharacterFaceUrl(form.internalCode) : undefined}
									alt={`${posLabel} ${elemLabel}`}
									fill
									unoptimized
									className="object-cover object-top"
									sizes="56px"
								/>
							</div>

							{/* Element badge overlay */}
							{elemIcon && (
								<div className="absolute bottom-0.5 right-0.5 size-4 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
									<NextImage
										src={elemIcon}
										alt=""
										width={12}
										height={12}
										className="size-3 object-contain"
									/>
								</div>
							)}

							{/* BASARA indicator */}
							{isBasara && (
								<div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-[#4facfe] via-[#7367f0] to-[#9733ee]" />
							)}

							{/* Hero indicator — color by type */}
							{isHero && form.heroType === "fire" && (
								<div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-red-500 via-orange-400 to-red-500" />
							)}
							{isHero && form.heroType === "black" && (
								<div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-gray-600 via-gray-800 to-gray-600" />
							)}
							{isHero && form.heroType === "pink" && (
								<div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-pink-400 via-rose-300 to-pink-400" />
							)}
							{isHero && !form.heroType && (
								<div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-amber-400 via-yellow-300 to-amber-400" />
							)}

							{/* Position label at bottom */}
							<div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 to-transparent pt-3 pb-0.5 px-1">
								<span className="text-xs sm:text-[8px] font-bold text-white/90 block text-center leading-tight truncate">
									{pos}
								</span>
							</div>
						</NextLink>
					);
				})}
			</div>
		</div>
	);
}
