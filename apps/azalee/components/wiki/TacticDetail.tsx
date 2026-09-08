"use client";

import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
	TacticDetail as SharedTacticDetail,
	type TacticDetailRecord,
} from "@niers/inacord-ui/components/wiki/wiki/TacticDetail";
import { SHOP_FR, translateEffect } from "@rosegriffon/azalee/text/translations";

interface Tactic extends Omit<TacticDetailRecord, "localizedName" | "secondaryName" | "description" | "secondaryDescription" | "effects" | "image" | "shop"> {
	name_fr?: string;
	name_ja?: string;
	description_fr?: string | null;
	description_en?: string | null;
	description_ja?: string | null;
	effect1: string | null;
	effect2: string | null;
	effect3: string | null;
	shop: string | null;
	recastTime?: number | null;
	image?: string | null;
	imageUrl?: string | null;
}

/** Azalée adapter: translation, Next media and route ownership remain in the host. */
export function TacticDetail({ tactic }: { tactic: Tactic }) {
	const effects = [tactic.effect1, tactic.effect2, tactic.effect3]
		.filter((effect): effect is string => Boolean(effect))
		.map((effect) => {
			const translated = translateEffect(effect);
			return { text: translated, secondaryText: translated === effect ? null : effect };
		});
	return <SharedTacticDetail
		tactic={{
			...tactic,
			localizedName: tactic.name_fr,
			secondaryName: tactic.name_ja,
			description: tactic.description_fr,
			secondaryDescription: tactic.description_ja,
			effects,
			shop: tactic.shop ? SHOP_FR[tactic.shop] || tactic.shop : null,
			image: tactic.imageUrl || tactic.image,
			element: tactic.element === "Néant" ? null : tactic.element,
		}}
		labels={{ back: "Retour à la liste", category: "Tactique Spéciale", power: "Puissance", duration: "Durée", cooldown: "Recharge", effects: "Effets", availability: "Disponibilité" }}
		renderBackLink={(label) => <Link href="/tactic" className="inline-flex items-center gap-2 text-sm font-medium text-on-surface-variant hover:text-primary transition-colors"><ArrowLeft size={20} aria-hidden="true" />{label}</Link>}
		renderImage={({ src, alt, onError }) => <Image src={src} alt={alt} width={1728} height={352} sizes="(max-width: 640px) 100vw, 384px" className="w-full h-auto object-contain" unoptimized onError={onError} />}
	/>;
}
