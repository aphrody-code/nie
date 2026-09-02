"use client";

import { ClipboardList } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { getCharacterFaceUrl } from "@rosegriffon/azalee/images";

interface CoachFaceProps {
	/**
	 * Code interne du personnage homonyme (`c0xxxxxxx`). `null` pour les NPC sans
	 * personnage correspondant → fallback icône directement.
	 */
	internalCode?: string | null;
	/** Texte alternatif (nom du coach). */
	alt: string;
	/** Taille de l'icône de fallback `ClipboardList`. */
	iconSize?: number;
	/** Classes appliquées UNIQUEMENT à l'icône de fallback (couleur/opacité). */
	className?: string;
}

/**
 * Portrait d'un entraîneur (en-tête de fiche). Îlot client : dérive le visage du
 * personnage homonyme via `getCharacterFaceUrl(internalCode)` (client-safe) et
 * retombe sur l'icône « sifflet » `ClipboardList` si le code est absent ou si
 * l'image échoue au chargement. Permet à `CoachDetail` (RSC) de rester serveur.
 */
export function CoachFace({ internalCode, alt, iconSize = 40, className }: CoachFaceProps) {
	const [imageFailed, setImageFailed] = useState(false);
	const faceUrl = internalCode ? getCharacterFaceUrl(internalCode) : null;

	if (!faceUrl || imageFailed) {
		return <ClipboardList size={iconSize} className={className} aria-hidden="true" />;
	}

	return (
		<Image
			src={faceUrl}
			alt={alt}
			fill
			sizes="96px"
			unoptimized
			className="object-contain"
			onError={() => setImageFailed(true)}
		/>
	);
}
