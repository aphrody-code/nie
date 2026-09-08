"use client";

import NextImage from "next/image";
import NextLink from "next/link";
import { SafeImage } from "@/components/ui/SafeImage";
import { getCharacterFaceUrl, getSkillElementIconUrl } from "@rosegriffon/azalee/images";
import {
	FormSelector as SharedFormSelector,
	type FormSelectorForm,
} from "@niers/inacord-ui/components/wiki/wiki/FormSelector";

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
		<SharedFormSelector
			forms={forms}
			currentFormId={currentFormId}
			labels={{
				heading: "Formes",
				position: (position) => POSITION_FR[position] || position,
				element: (element) => ELEMENT_FR[element] || element,
				heroType: (heroType) => ({ black: "Ombre", fire: "Feu", pink: "Rose" })[heroType] || heroType,
			}}
			resolvePortrait={(form) => {
				const fallbackSrc = form.internalCode ? getCharacterFaceUrl(form.internalCode) : undefined;
				return {
					src: form.zukanHash
						? `https://dxi4wb638ujep.cloudfront.net/1/${form.zukanHash}.png`
						: fallbackSrc || "/ievr.webp",
					fallbackSrc,
					zukanHash: form.zukanHash,
					alt: `${POSITION_FR[POSITION_MAP[form.position] || form.position] || form.position} ${ELEMENT_FR[form.element] || form.element}`,
				};
			}}
			renderPortrait={({ src, zukanHash, fallbackSrc, alt }) => (
				<SafeImage
					src={src}
					zukanHash={zukanHash}
					fallbackSrc={fallbackSrc}
					alt={alt}
					fill
					unoptimized
					className="object-cover object-top"
					sizes="56px"
				/>
			)}
			renderElementIcon={(form) => {
				const icon = getSkillElementIconUrl(form.element);
				return icon ? <NextImage src={icon} alt="" width={12} height={12} className="size-3 object-contain" /> : null;
			}}
			renderItem={({ form, className, title, onSelect, children }) => (
				<NextLink key={form.id} href={`/chara/${form.slug}`} className={className} title={title} onClick={onSelect}>
					{children}
				</NextLink>
			)}
		/>
	);
}
