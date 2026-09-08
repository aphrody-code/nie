"use client";

import { Fragment, type ReactNode } from "react";

import { cn } from "../../../lib/utils";

export interface FormSelectorForm {
	id: string;
	slug: string;
	position: string;
	element: string;
	rarity: string;
	zukanHash?: string;
	internalCode?: string;
	heroType?: string;
}

export interface FormSelectorLabels {
	heading: string;
	position: (position: string) => string;
	element: (element: string) => string;
	heroType: (heroType: string) => string;
}

export interface FormSelectorPortrait {
	src: string;
	alt: string;
	fallbackSrc?: string;
	zukanHash?: string;
}

export interface FormSelectorItem<TForm extends FormSelectorForm> {
	form: TForm;
	className: string;
	title: string;
	onSelect: () => void;
	children: ReactNode;
}

export interface FormSelectorProps<TForm extends FormSelectorForm> {
	forms: readonly TForm[];
	/** The selected form is owned by the host route or host state. */
	currentFormId?: string;
	labels: FormSelectorLabels;
	resolvePortrait: (form: TForm) => FormSelectorPortrait;
	renderPortrait: (portrait: FormSelectorPortrait) => ReactNode;
	renderElementIcon?: (form: TForm) => ReactNode;
	/**
	 * Hosts with routing can wrap each item in their own link. Without this slot
	 * the component remains a controlled button selector.
	 */
	renderItem?: (item: FormSelectorItem<TForm>) => ReactNode;
	onFormSelect?: (form: TForm) => void;
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

const HERO_RING_CLASSES: Record<string, { idle: string; selected: string; stripe: string }> = {
	black: {
		idle: "ring-gray-500/40",
		selected: "ring-2 ring-gray-500 shadow-gray-500/30",
		stripe: "bg-linear-to-r from-gray-600 via-gray-800 to-gray-600",
	},
	fire: {
		idle: "ring-red-400/40",
		selected: "ring-2 ring-red-400 shadow-red-500/30",
		stripe: "bg-linear-to-r from-red-500 via-orange-400 to-red-500",
	},
	pink: {
		idle: "ring-pink-400/40",
		selected: "ring-2 ring-pink-400 shadow-pink-500/30",
		stripe: "bg-linear-to-r from-pink-400 via-rose-300 to-pink-400",
	},
};

const DEFAULT_HERO_RING = {
	idle: "ring-amber-400/40",
	selected: "ring-2 ring-amber-400 shadow-amber-500/30",
	stripe: "bg-linear-to-r from-amber-400 via-yellow-300 to-amber-400",
};

/**
 * Shared controlled presentation for alternate character forms. The host owns
 * routing, localised labels and VFS/CDN image decoding through explicit slots.
 */
export function FormSelector<TForm extends FormSelectorForm>({
	forms,
	currentFormId,
	labels,
	resolvePortrait,
	renderPortrait,
	renderElementIcon,
	renderItem,
	onFormSelect,
}: FormSelectorProps<TForm>) {
	if (forms.length <= 1) {
		return null;
	}

	return (
		<div className="space-y-1.5 text-center sm:text-left w-full">
			<span className="text-[10px] font-black uppercase tracking-widest text-white/40 block">
				{labels.heading}
			</span>
			<div className="flex items-center justify-center sm:justify-start gap-2 overflow-x-auto pb-1 scrollbar-none w-full">
				{forms.map((form) => {
					const isCurrent = form.id === currentFormId;
					const position = POSITION_MAP[form.position] || form.position;
					const positionLabel = labels.position(position);
					const elementLabel = labels.element(form.element);
					const isBasara = form.rarity === "BASARA";
					const isHero = form.rarity === "Héros";
					const heroClasses = HERO_RING_CLASSES[form.heroType ?? ""] ?? DEFAULT_HERO_RING;
					const heroSuffix = form.heroType ? ` ${labels.heroType(form.heroType)}` : "";
					const raritySuffix = form.rarity !== "Normal" ? ` (${form.rarity}${heroSuffix})` : "";
					const title = `${positionLabel} ${elementLabel}${raritySuffix}`;
					const portrait = resolvePortrait(form);
					const className = cn(
						"relative shrink-0 rounded-xl overflow-hidden transition-all group",
						"size-14 sm:w-[56px] sm:h-[56px]",
						isCurrent
							? "ring-2 ring-primary shadow-lg shadow-primary/20 opacity-100"
							: "opacity-70 hover:opacity-100 ring-1 ring-white/20 hover:ring-white/40",
						isBasara && !isCurrent && "ring-purple-400/40",
						isBasara && isCurrent && "ring-2 ring-purple-400 shadow-purple-500/30",
						isHero && !isCurrent && heroClasses.idle,
						isHero && isCurrent && heroClasses.selected,
					);
					const children = (
						<>
							<div className="absolute inset-0 bg-black/40">{renderPortrait(portrait)}</div>
							{renderElementIcon ? (
								<div className="absolute bottom-0.5 right-0.5 size-4 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
									{renderElementIcon(form)}
								</div>
							) : null}
							{isBasara ? (
								<div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-[#4facfe] via-[#7367f0] to-[#9733ee]" />
							) : null}
							{isHero ? <div className={cn("absolute top-0 left-0 right-0 h-1", heroClasses.stripe)} /> : null}
							<div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 to-transparent pt-3 pb-0.5 px-1">
								<span className="text-xs sm:text-[8px] font-bold text-white/90 block text-center leading-tight truncate">
									{position}
								</span>
							</div>
						</>
					);
					const item = { form, className, title, onSelect: () => onFormSelect?.(form), children };

					return renderItem ? (
						<Fragment key={form.id}>{renderItem(item)}</Fragment>
					) : (
						<button
							key={form.id}
							type="button"
							className={className}
							title={title}
							aria-pressed={isCurrent}
							onClick={item.onSelect}
						>
							{children}
						</button>
					);
				})}
			</div>
		</div>
	);
}
