import {
	AlertCircle,
	Dumbbell,
	Hourglass,
	ShoppingBag,
	Sparkles,
	Store,
	Timer,
	TrendingUp,
	Users,
} from "lucide-react";

export interface SkillDetailRecipeCost {
	name: string;
	quantity: number;
}

export interface SkillDetailRecipe {
	shop: string;
	costs: SkillDetailRecipeCost[];
}

export interface SkillDetailInfoProps {
	powerMin?: number | string | null;
	powerMax?: number | string | null;
	foulRate?: number | null;
	duration?: number | string | null;
	evolution?: string | number | null;
	partnerCount?: number | null;
	recastTime?: number | null;
	internalId: string;
	description: string;
	descriptionEnglish?: string | null;
	descriptionJapanese?: string | null;
	effects?: string[];
	recipes?: SkillDetailRecipe[] | null;
	shops?: string[];
	additionalShop?: string | null;
	tags?: string[];
}

/**
 * Host-neutral information panel for a technique detail page.
 *
 * The caller resolves game text, community metadata and localized shop names;
 * this component only renders the normalized values. Media, routing and data
 * access deliberately remain outside the shared presentation owner.
 */
export function SkillDetailInfo({
	powerMin,
	powerMax,
	foulRate,
	duration,
	evolution,
	partnerCount,
	recastTime,
	internalId,
	description,
	descriptionEnglish,
	descriptionJapanese,
	effects,
	recipes,
	shops = [],
	additionalShop,
	tags,
}: SkillDetailInfoProps) {
	const normalizedShops = new Set(shops.map((shop) => shop.toLowerCase()));
	const showAdditionalShop = Boolean(additionalShop && !normalizedShops.has(additionalShop.toLowerCase()));
	const hasRecipes = Boolean(recipes && recipes.length > 0);
	const hasShops = shops.length > 0 || showAdditionalShop;

	return (
		<div className="bg-surface-container-high/50 hover:bg-surface-container-high transition-colors rounded-xl p-4 cursor-default">
			<div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-bold text-on-surface mb-4">
				{powerMin != null && powerMax != null && (
					<span className="inline-flex items-center gap-1.5">
						<Dumbbell size={16} className="text-primary" aria-hidden="true" />
						{powerMin}-{powerMax} Puissance
					</span>
				)}
				{foulRate !== undefined && foulRate !== null && foulRate > 0 && (
					<span className="inline-flex items-center gap-1.5">
						<AlertCircle size={16} className="text-tertiary" aria-hidden="true" />
						{foulRate}% Faute
					</span>
				)}
				{duration != null && (
					<span className="inline-flex items-center gap-1.5">
						<Hourglass size={16} className="text-on-surface-variant" aria-hidden="true" />
						{duration} sec.
					</span>
				)}
				{evolution && (
					<span className="inline-flex items-center gap-1.5">
						<TrendingUp size={16} className="text-secondary" aria-hidden="true" />
						{evolution} Évolution
					</span>
				)}
				{partnerCount !== undefined && partnerCount !== null && partnerCount > 0 && (
					<span className="inline-flex items-center gap-1.5">
						<Users size={16} className="text-on-surface-variant" aria-hidden="true" />
						{partnerCount + 1} Joueurs
					</span>
				)}
				{recastTime !== undefined && recastTime !== null && recastTime > 0 && (
					<span className="inline-flex items-center gap-1.5">
						<Timer size={16} className="text-on-surface-variant" aria-hidden="true" />
						{recastTime} Recharge
					</span>
				)}
				<span className="opacity-40 font-mono font-normal">#{internalId}</span>
			</div>

			<div className="text-on-surface-variant text-sm whitespace-pre-line leading-relaxed mb-2">
				{description || "Aucune description disponible."}
			</div>
			{descriptionEnglish && descriptionEnglish !== description && (
				<div className="text-on-surface-variant/60 text-xs whitespace-pre-line leading-relaxed mb-2 italic">
					{descriptionEnglish}
				</div>
			)}
			{descriptionJapanese && (
				<div className="text-on-surface-variant/50 text-xs whitespace-pre-line leading-relaxed mb-4 font-light">
					{descriptionJapanese}
				</div>
			)}

			{effects && effects.length > 0 && (
				<div className="border-t border-outline-variant/20 pt-3 mt-3 mb-2">
					<div className="flex items-center gap-1.5 mb-2">
						<Sparkles size={16} className="text-tertiary" aria-hidden="true" />
						<span className="text-xs font-bold text-on-surface-variant uppercase tracking-wide">Effets</span>
					</div>
					<ul className="list-disc list-inside text-sm space-y-1">
						{effects.map((effect, index) => (
							<li key={`${effect}-${index}`} className="text-on-surface-variant font-medium">{effect}</li>
						))}
					</ul>
				</div>
			)}

			{hasRecipes ? (
				<div className="border-t border-outline-variant/20 pt-3 mt-3">
					<ObtainmentTitle />
					<div className="space-y-2">
						{recipes!.map((recipe, index) => (
							<div key={`${recipe.shop}-${index}`} className="p-2 rounded-lg bg-surface-container-high/50 border border-outline-variant/10">
								<div className="text-[10px] font-bold text-on-surface-variant/60 uppercase mb-1">{recipe.shop}</div>
								<div className="flex flex-wrap gap-1.5">
									{recipe.costs.map((cost, costIndex) => (
										<span key={`${cost.name}-${costIndex}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-[11px] font-bold border border-primary/20">
											<span className="text-on-surface font-black">{cost.quantity}x</span>{cost.name}
										</span>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			) : hasShops ? (
				<div className="border-t border-outline-variant/20 pt-3 mt-3">
					<ObtainmentTitle />
					<div className="flex flex-wrap gap-2">
						{shops.map((shop, index) => <ShopBadge key={`${shop}-${index}`} shop={shop} />)}
						{showAdditionalShop && <ShopBadge shop={additionalShop!} />}
					</div>
				</div>
			) : null}

			{tags && tags.length > 0 && (
				<div className="flex flex-wrap gap-2 mt-3">
					{tags.map((tag, index) => (
						<span key={`${tag}-${index}`} className="px-2 py-1 rounded bg-tertiary-container/30 text-tertiary text-xs font-bold uppercase tracking-wide">
							#{tag.replaceAll(/\s+/g, "")}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

function ObtainmentTitle() {
	return (
		<div className="flex items-center gap-1.5 mb-2">
			<Store size={16} className="text-secondary" aria-hidden="true" />
			<span className="text-xs font-bold text-on-surface-variant uppercase tracking-wide">Obtention</span>
		</div>
	);
}

function ShopBadge({ shop }: { shop: string }) {
	return (
		<span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary-container/30 text-secondary text-xs font-bold">
			<ShoppingBag size={14} aria-hidden="true" />
			{shop}
		</span>
	);
}
