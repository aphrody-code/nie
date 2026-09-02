// Données crawlées du site officiel https://www.inazuma-cross.jp/ + tweets réels @inazuma_cross.
// Source canonique : apps/azalee/data/inazuma-cross.json (tracké, sans PII).
// Traduction FR (champs *Fr) STRICTEMENT FACTUELLE : chaque bloc est la traduction d'un texte réel
// (JP) du site officiel ou d'un vrai tweet. Le site officiel n'a pas de version FR.
import raw from "@/data/inazuma-cross.json";

export interface CrossNews {
	date: string;
	titleJa: string;
	titleFr: string;
	url: string;
	tagJa: string;
	tagFr: string;
}

export interface CrossCharacter {
	position: string;
	tagJa: string;
	tagFr: string;
	nameJa: string;
	nameFr: string;
	skillsJa: string[];
	skillsFr: string[];
	image?: string;
	icon?: string;
	hissatsuImages?: string[];
}

export interface CrossPillar {
	ja: string;
	fr: string;
}

export interface CrossTweet {
	id: string;
	date: string;
	textJa: string;
	textFr: string;
	url: string;
	hasMedia: boolean;
}

export interface CrossCbtMode {
	nameJa: string;
	nameFr: string;
	descFr: string;
}

export interface CrossData {
	site: {
		title: string;
		titleRomaji: string;
		subtitle: string;
		subtitleFr: string;
		description: string;
		descriptionFr: string;
		ogImage: string;
	};
	status: {
		phase: string;
		phaseLabelJa: string;
		phaseLabelFr: string;
		serviceStart: string;
		serviceStartLabelJa: string;
		serviceStartLabelFr: string;
		note: string;
		noteFr: string;
	};
	spec: {
		title: string;
		genre: string;
		genreFr: string;
		platforms: string;
		pricing: string;
		pricingFr: string;
		releaseDate: string;
		developers: string[];
		copyright: string;
		collabCopyright: string;
	};
	disclaimerFr: string;
	introduction: { headingJa: string; headingFr: string; storyJa: string; storyFr: string; storySource: string };
	protagonist: {
		nameJa: string;
		nameReadingJa: string;
		nameRomaji: string;
		descriptionJa: string;
		descriptionFr: string;
		image: string;
	};
	system: { headingJa: string; headingFr: string; noteFr: string; pillars: CrossPillar[] };
	news: CrossNews[];
	rewards: { headingJa: string; headingFr: string; noteFr: string; images: string[] };
	samuraiBlue2026: {
		titleJa: string;
		titleFr: string;
		url: string;
		leadFr: string;
		eventPeriod: string;
		eventPeriodFr: string;
		limitedCharactersHeadingFr: string;
		limitedCharacters: CrossCharacter[];
		designNoteJa: string;
		designNoteFr: string;
		catchFr: string;
		wearItem: { headingFr: string; descriptionFr: string; image: string };
		loginBonus: { headingFr: string; descriptionFr: string; periodFr: string };
		advertisement: { headingFr: string; outdoorFr: string; adTruckFr: string };
		character: string;
		banner: string;
	};
	cbtReport: {
		url: string;
		headingJa: string;
		headingFr: string;
		introFr: string;
		modes: CrossCbtMode[];
		plannedAdjustmentsFr: string[];
	};
	movies: { headingJa: string; headingFr: string; youtube: { id: string; labelJa?: string; labelFr: string }[] };
	tweets: CrossTweet[];
	tweetsNote: string;
	links: Record<string, string | string[]>;
	localImages: {
		keyVisual: string;
		logo: string;
		commonBg: string;
		commonBgPattern: string;
		introHeading: string;
		introBg: string;
		protagonist: string;
		characterName: string;
		systemHeading: string;
		rewardHeading: string;
		rewardBadge: string;
		appicon: string;
		ogp: string;
		samuraiBlueBanner: string;
		samuraiBlueKeyVisual: string;
		samuraiBlueCharacter: string;
		samuraiBlueItems: string;
		systemScreenshots: string[];
		systemText: string[];
		rewardImages: string[];
		samuraiBlueSlides: string[];
		samuraiBlueWear: string[];
		samuraiBlueAds: string[];
		samuraiBlueAdChars: string[];
		cbtBanner: string;
		cbtResults: string;
		cbtProgressRanking: string;
		cbtScreenshots: string[];
		youtubeThumbs: Record<string, string>;
		footerBanners: { youtube: string; x: string; report: string; inazuma: string; victoryRoad: string };
		logoLevel5: string;
		logoAiming: string;
		rewardAchieve: string[];
		firstview: string;
		preregistrationText: string;
		badgeAppStore: string;
		badgeGooglePlay: string;
	};
}

export const crossData = raw as unknown as CrossData;
