"use client";

import { CircleDot } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { AuraCard } from "@/components/wiki/AuraCard";
import { WikiPagination } from "@/components/wiki/WikiPagination";
import { WikiSearchToolbar } from "@/components/wiki/WikiSearchToolbar";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { translatePassiveEffect } from "@rosegriffon/azalee/text/aura-translations";
import { cn } from "@/lib/utils";

/**
 * Taille de page des auras — autorité UNIQUE, importée par la page serveur qui
 * interroge la base. Une constante dupliquée des deux côtés finirait par diverger,
 * et une découpe locale d'une page déjà découpée rendait les auras suivantes
 * inatteignables (total menteur, donc une seule page).
 */
export const AURAS_PAR_PAGE = 48;

const ELEMENTS = [
	{ icon: "blur_on", label: "Tous", value: "" },
	{ commonSprite: "fire" as SpriteCommonKey, label: "Feu", value: "Fire" },
	{ commonSprite: "wind" as SpriteCommonKey, label: "Vent", value: "Wind" },
	{ commonSprite: "forest" as SpriteCommonKey, label: "Forêt", value: "Forest" },
	{ commonSprite: "mountain" as SpriteCommonKey, label: "Montagne", value: "Mountain" },
	{ icon: "blur_on", label: "Néant", value: "Void" },
];

interface AuraItem {
	id: string;
	auraId: string;
	name: string;
	passive?: string;
	hissatsu_name?: string;
	element?: string;
	image_url?: string;
	type?: string;
	sheetData?: any;
	assetCode?: string;
}

/**
 * Grille paginée d'une catégorie d'auras.
 *
 * Ne filtre et ne découpe RIEN : la recherche, le filtre d'élément et la
 * découpe en pages sont faits par la base (le service reçoit `q`, `element`,
 * `page`). Le composant se contente d'afficher la page reçue et de renvoyer
 * les changements de filtre dans l'URL, seule source de vérité partagée.
 */
export function AuraList({
	auras,
	category,
	total,
	page,
	perPage = AURAS_PAR_PAGE,
}: {
	auras: AuraItem[];
	category: string;
	/** Nombre réel d'auras de la catégorie après filtres, compté en base. */
	total: number;
	/** Page courante, telle que résolue par la page serveur depuis `?page=`. */
	page: number;
	perPage?: number;
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const element = searchParams.get("element") || "";
	const totalPages = Math.max(1, Math.ceil(total / perPage));

	const updateElement = useCallback(
		(value: string) => {
			const params = new URLSearchParams(searchParams.toString());
			const current = params.get("element") || "";

			if (current === value || value === "") {
				params.delete("element");
			} else {
				params.set("element", value);
			}

			params.delete("page");
			router.push(`/aura/${category}?${params.toString()}`);
		},
		[router, searchParams, category]
	);

	return (
		<div className="space-y-6">
			<div className="space-y-4">
				<WikiSearchToolbar placeholder="Rechercher..." showFilters={false} />

				{/* Element Chips - same style as SkillFilterBar */}
				<div className="flex flex-wrap gap-2">
					{ELEMENTS.map((f) => {
						const isActive =
							f.value === "" ? !element : element.toLowerCase() === f.value.toLowerCase();
						return (
							<button
								key={f.value}
								onClick={() => updateElement(f.value)}
								className={cn(
									"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
									"transition-all duration-200 border cursor-pointer",
									isActive
										? "bg-secondary text-on-secondary border-secondary shadow-sm"
										: "bg-surface-container-low hover:bg-surface-container border-outline-variant/20 text-on-surface-variant hover:text-on-surface"
								)}
							>
								{f.commonSprite ? (
									<CommonSpriteIcon name={f.commonSprite} scale={0.28} />
								) : f.icon === "blur_on" ? (
									<CircleDot size={18} aria-hidden="true" />
								) : null}
								<span>{f.label}</span>
							</button>
						);
					})}
				</div>
			</div>

			<div className="flex items-center justify-between text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				<span>{total.toLocaleString("fr-FR")} résultats</span>
				<span>
					Page {page} sur {totalPages}
				</span>
			</div>

			{auras.length > 0 ? (
				<FadeInStagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{auras.map((aura) => {
						const sd = aura.sheetData || {};
						const passiveRaw = sd.passiveEffect;
						const passiveFr = passiveRaw ? translatePassiveEffect(passiveRaw) : undefined;
						const hissatsuName = sd.hissatsu?.name || aura.hissatsu_name;

						return (
							<FadeInItem key={aura.id} className="h-full">
								<AuraCard
									id={aura.id}
									name={aura.name || "Inconnu"}
									description={aura.passive}
									element={{ en: aura.element || undefined, fr: aura.element || undefined }}
									image={aura.image_url || undefined}
									assetCode={aura.assetCode || undefined}
									subType={aura.type || undefined}
									category={category}
									passiveEffect={passiveFr}
									hissatsuName={hissatsuName}
									className="h-full"
								/>
							</FadeInItem>
						);
					})}
				</FadeInStagger>
			) : (
				<div className="py-20 text-center rounded-[32px] border border-outline-variant bg-surface-container-low border-dashed">
					<p className="text-on-surface-variant italic">Aucun résultat trouvé.</p>
				</div>
			)}

			<WikiPagination totalItems={total} itemsPerPage={perPage} currentPage={page} />
		</div>
	);
}
