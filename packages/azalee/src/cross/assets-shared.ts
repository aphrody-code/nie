/**
 * Partie CLIENT-SAFE des résolutions d'assets et CDN pour Inazuma Eleven Cross.
 *
 * Ce module fournit des helpers pour construire les URLs CDN des voix de
 * personnages (WAV), des assets d'interface locaux et prépare la résolution
 * des assets distants une fois le CDN de Level-5 débloqué (Phase 1).
 */

import audioManifest from "../data/cross/audio-manifest.json";

export const CROSS_CDN_BASE = "https://cdn.rosegriffon.fr/cross";

export interface CrossVoiceClip {
	cueName: string;
	url: string;
}

/**
 * Récupère la liste des clips audio (voix) disponibles pour un code de personnage donné.
 *
 * @param characterCode Code du personnage (ex: "c00001001" ou format brut 1001)
 * @returns Tableau d'objets CrossVoiceClip contenant le nom de l'action/cue et son URL sur le CDN
 */
export function getCrossCharacterVoices(characterCode: string | number | undefined | null): CrossVoiceClip[] {
	if (!characterCode) return [];

	let formattedCode = characterCode.toString();
	if (!formattedCode.startsWith("c")) {
		formattedCode = `c${formattedCode.padStart(8, "0")}`;
	}

	const characters = (audioManifest as any).characters || {};
	const cues = characters[formattedCode] as string[] | undefined;
	if (!cues) return [];

	return cues.map((cue) => {
		// cue est sous la forme "001_c00001001_GameStart"
		// Le fichier réel sur le CDN est "c00001001_<cue>.wav"
		const cleanCue = cue.replace(/;.*$/, "").trim(); // Nettoie les cue multiples séparés par des point-virgules
		const url = `${CROSS_CDN_BASE}/audio/${formattedCode}_${cleanCue}.wav`;

		// Extraction du label lisible à la fin (ex: "GameStart")
		const labelMatch = cleanCue.match(/_([A-Za-z]+)$/);
		const label = labelMatch ? labelMatch[1] : cleanCue;

		return {
			cueName: label,
			url,
		};
	});
}

/**
 * Résout le chemin d'un asset local d'UI ou de police extrait de l'APK (Phase 0) vers le CDN.
 *
 * @param relativePath Chemin relatif de l'asset sous assets-local/ (ex: "textures/Knob.png")
 * @returns L'URL CDN absolue
 */
export function getCrossLocalAssetUrl(relativePath: string): string {
	const cleanPath = relativePath.startsWith("/") ? relativePath.slice(1) : relativePath;
	return `${CROSS_CDN_BASE}/assets-local/${cleanPath}`;
}

/**
 * Résout le chemin logique Addressables (ou l'ID interne du catalogue) vers le CDN local
 * pour Inazuma Eleven Cross.
 *
 * @param address Chemin logique Addressables (ex: "Icons/Character/c00001001.png")
 * @returns L'URL CDN résolue (locale, ou distante via le fallback local en cas de sync)
 */
export function resolveCrossAssetUrl(address: string | undefined | null): string {
	if (!address) return "";

	// Si c'est déjà une URL absolue, on la renvoie
	if (address.startsWith("http://") || address.startsWith("https://") || address.startsWith("/")) {
		return address;
	}

	// Suppression du préfixe classique des Addressables Unity si présent
	let cleanAddress = address;
	if (cleanAddress.startsWith("Assets/Addressables/")) {
		cleanAddress = cleanAddress.slice("Assets/Addressables/".length);
	}

	// Phase 0 : Vérifier si l'adresse matche une texture/sprite ou police locale
	// Pour les fonts : Goldman-Regular, BO-SoftGoStd, etc.
	if (cleanAddress.toLowerCase().includes("font")) {
		if (cleanAddress.toLowerCase().includes("goldman")) {
			return getCrossLocalAssetUrl("fonts/Goldman-Regular.ttf");
		}
		if (cleanAddress.toLowerCase().includes("softgo")) {
			return getCrossLocalAssetUrl("fonts/BO-SoftGoStd-Bd.ttf");
		}
		if (cleanAddress.toLowerCase().includes("sansrf")) {
			return getCrossLocalAssetUrl("fonts/GSanSrfStd-Rg.ttf");
		}
	}

	// Pour les textures d'UI communes locales
	const baseName = cleanAddress.split("/").pop() || "";
	if (baseName) {
		const localUiTextures = [
			"Knob.png", "Checkmark.png", "DropdownArrow.png", "UIMask.png", "UISprite.png",
			"Background.png", "Default-ParticleSystem.png", "Default-Skybox-Cubemap.png",
			"Img_BlueGradation.png", "Img_BronzeText.png", "Img_EmeraldGreenGradation.png",
			"Img_GoldGradation.png", "Img_GolgText.png", "Img_GreenGradation.png",
			"Img_OrangeGradation.png", "Img_SilverText.png", "InputFieldBackground.png"
		];
		if (localUiTextures.includes(baseName)) {
			// On préfère les sprites pour l'UI, sinon textures
			if (cleanAddress.toLowerCase().includes("sprite") || cleanAddress.toLowerCase().includes("atlas")) {
				return getCrossLocalAssetUrl(`sprites/${baseName}`);
			}
			return getCrossLocalAssetUrl(`textures/${baseName}`);
		}
	}

	// Phase 1 fallback (bloqué actuellement) :
	// Pour les assets distants de gameplay/persos, l'organisation cible sur le CDN
	// respecte l'arborescence logique sous /cross/ (ex: /cross/Icons/Character/c00001001.png)
	return `${CROSS_CDN_BASE}/${cleanAddress}`;
}
