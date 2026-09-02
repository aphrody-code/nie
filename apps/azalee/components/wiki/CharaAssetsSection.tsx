"use client";

/**
 * Section "Assets du jeu" d'une fiche perso : affiche le **modèle 3D** assemblé
 * (corps+visage+uniforme, `/model-full/<code>.glb`) et la **voix** (`/audio/.../​<code>.acb`
 * → WAV) — déjà servis live par niers mais absents des colonnes du miroir azalee.
 * Reçoit le code interne (`internalCode`, ex. `c01001900`).
 */
import dynamic from "next/dynamic";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

const CharacterModelViewer = dynamic(() => import("@/components/wiki/CharacterModelViewer"), {
	ssr: false,
});

const CDN = "https://cdn.rosegriffon.fr";

export function CharaAssetsSection({
	internalCode,
	displayName,
}: {
	internalCode: string;
	/** Nom lisible du personnage — utilisé pour l'alt/titre/nom de fichier du viewer 3D, jamais le code interne. */
	displayName?: string;
}) {
	const [voiceFailed, setVoiceFailed] = useState(false);
	if (!internalCode || !/^c\d{6,9}$/i.test(internalCode)) return null;

	const glbUrl = `${CDN}/model-full/${internalCode}.glb`;
	const voiceUrl = `${CDN}/audio/data/common/sound_asset/ja/${internalCode}.acb`;

	return (
		<section className="rounded-3xl border border-outline-variant/20 bg-surface-container-low/40 p-5 space-y-4">
			<h2 className="flex items-center gap-2 text-fluid-title-md font-bold text-on-surface">
				<Icon name="deployed_code" size={20} className="text-primary" />
				Assets du jeu
			</h2>

			<div>
				<p className="text-xs text-on-surface-variant mb-1">
					Modèle 3D (corps + visage + uniforme)
				</p>
				<CharacterModelViewer glbUrl={glbUrl} name={displayName || "personnage"} inline />
			</div>

			{!voiceFailed && (
				<div>
					<p className="text-xs text-on-surface-variant mb-1">Voix (JP)</p>
					{/* eslint-disable-next-line jsx-a11y/media-has-caption */}
					<audio
						controls
						preload="none"
						className="w-full max-w-md"
						src={voiceUrl}
						onError={() => setVoiceFailed(true)}
					/>
				</div>
			)}
		</section>
	);
}
