"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
	GAME_LOCALES,
	isGameLocale,
	type GameLocale,
} from "@niers/asset-source";
// Import default locale directly to prevent hydration mismatch and flash of keys
import frDictionary from "@/public/locales/fr.json";

/**
 * One selected game locale across Azalée, Inacord and nie-web.  The type and validation are
 * owned by `@niers/asset-source`, which follows the VFS rather than the subset of static
 * Azalée interface dictionaries.
 */
export type Language = GameLocale;
export const AZALEE_GAME_LOCALES = GAME_LOCALES;

const STATIC_DICTIONARY_LOCALES = new Set(["fr", "en", "ja"] as const);
type StaticDictionaryLocale = "fr" | "en" | "ja";

function staticDictionaryLocale(language: GameLocale): StaticDictionaryLocale {
	return STATIC_DICTIONARY_LOCALES.has(language as StaticDictionaryLocale)
		? (language as StaticDictionaryLocale)
		: "fr";
}

interface LanguageContextType {
	language: Language;
	setLanguage: (lang: Language) => void;
	t: (hash: string | number | undefined | null) => string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getLocalized: (obj: any, fieldPrefix?: string) => string;
	isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
	const [language, setLanguageState] = useState<Language>("fr");
	// Initialize with static FR dictionary
	const [dictionary, setDictionary] = useState<Record<string, string>>(
		frDictionary as Record<string, string>
	);
	const [isLoading, setIsLoading] = useState(false);

	// Load language from localStorage (mount-only — hydration sync).
	useEffect(() => {
		const saved = localStorage.getItem("app_language");
		if (saved && isGameLocale(saved)) {
			setLanguageState(saved);
		}
	}, []);

	const setLanguage = (lang: Language) => {
		setLanguageState(lang);
		if (typeof window !== "undefined") {
			localStorage.setItem("app_language", lang);
		}
	};

	// La langue déclarée par le document doit suivre celle qui est réellement
	// affichée. `<html lang="fr">` est figé dans le gabarit racine : un lecteur
	// d'écran annonçait du japonais avec une voix française, et le navigateur
	// choisissait une police latine pour des kanji.
	useEffect(() => {
		document.documentElement.lang = language;
	}, [language]);

	// Static Azalée labels only exist for these three historical dictionaries. Game content is
	// resolved through the shared VFS locale by the data/resource layers; tool-only labels retain
	// the established French fallback until they have a verified game-text hash.
	useEffect(() => {
		const dictionaryLocale = staticDictionaryLocale(language);
		if (dictionaryLocale === "fr") {
			setDictionary(frDictionary as Record<string, string>);
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		fetch(`/locales/${dictionaryLocale}.json`)
			.then((res) => res.json())
			.then((data) => {
				setDictionary(data);
				setIsLoading(false);
			})
			.catch((error) => {
				console.error("Failed to load locale", error);
				// Fallback to FR on error
				setDictionary(frDictionary as Record<string, string>);
				setIsLoading(false);
			});
	}, [language]);

	const t = (hash: string | number | undefined | null) => {
		if (hash === undefined || hash === null) {
			return "";
		}
		const key = hash.toString();
		return dictionary[key] || key;
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const getLocalized = (obj: any, fieldPrefix: string = "name") => {
		if (!obj) {
			return "";
		}

		const langSuffix = language.toUpperCase();
		const targetKey = `${fieldPrefix}_${langSuffix}`;

		if (obj[targetKey]) {
			return obj[targetKey];
		}

		// Prefer an existing English game-data field before the historical French fallback.
		if (obj[`${fieldPrefix}_EN`]) {
			return obj[`${fieldPrefix}_EN`];
		}

		// Fallback to FR
		if (obj[`${fieldPrefix}_FR`]) {
			return obj[`${fieldPrefix}_FR`];
		}

		if (obj[`${fieldPrefix}_JA`]) {
			return obj[`${fieldPrefix}_JA`];
		}

		// Fallback to plain field or EN
		if (obj[fieldPrefix]) {
			return obj[fieldPrefix];
		}

		return "";
	};

	return (
		<LanguageContext.Provider value={{ getLocalized, isLoading, language, setLanguage, t }}>
			{children}
		</LanguageContext.Provider>
	);
}

export const useLanguage = () => {
	const context = useContext(LanguageContext);
	if (!context) {
		throw new Error("useLanguage must be used within a LanguageProvider");
	}
	return context;
};
