"use client";

import {
	ThemeProvider as NextThemesProvider,
	type ThemeProviderProps,
	useTheme as useNextTheme,
} from "next-themes";
import * as React from "react";
import { THEMES, type ThemeType } from "../lib/themes";

export interface RGThemeProviderProps extends ThemeProviderProps {
	children: React.ReactNode;
}

const ALL_THEMES = Object.keys(THEMES) as ThemeType[];

/**
 * Provider thèmes Rose Griffon — wrap next-themes avec la liste explicite
 * des thèmes supportés (sans dark/light auto). La classe est appliquée sur
 * `<html>` (`class="roy"`, etc.) et `styles.css` aligne sur ces noms.
 */
export function ThemeProvider({
	children,
	attribute = "class",
	defaultTheme = "roy",
	storageKey = "rg-theme",
	themes = ALL_THEMES,
	enableSystem = false,
	disableTransitionOnChange = true,
	...props
}: RGThemeProviderProps) {
	return (
		<NextThemesProvider
			attribute={attribute}
			defaultTheme={defaultTheme}
			storageKey={storageKey}
			themes={themes}
			enableSystem={enableSystem}
			disableTransitionOnChange={disableTransitionOnChange}
			{...props}
		>
			{children}
		</NextThemesProvider>
	);
}

/** Hook unifié — expose `mounted` pour éviter le mismatch SSR/CSR. */
export function useTheme() {
	const ctx = useNextTheme();
	const [mounted, setMounted] = React.useState(false);

	React.useEffect(() => {
		setMounted(true);
	}, []);

	const toggleTheme = React.useCallback(() => {
		const ordered: ThemeType[] = ["roy", "gaelle"];
		const idx = ordered.indexOf(ctx.theme as ThemeType);
		const next = ordered[(idx + 1) % ordered.length] ?? "roy";
		ctx.setTheme(next);
	}, [ctx]);

	const cycleTheme = React.useCallback(() => {
		const idx = ALL_THEMES.indexOf(ctx.theme as ThemeType);
		const next = ALL_THEMES[(idx + 1) % ALL_THEMES.length] ?? "roy";
		ctx.setTheme(next);
	}, [ctx]);

	return {
		...ctx,
		mounted,
		toggleTheme,
		cycleTheme,
		isRoy: ctx.theme === "roy",
		isGaelle: ctx.theme === "gaelle",
		isAzalee: ctx.theme?.startsWith("azalee") ?? false,
		// TOUJOURS une palette définie. Au rendu serveur (et avant hydratation)
		// `ctx.theme` est `undefined` : la version optionnelle renvoyait
		// `undefined`, et tout consommateur qui lit `colors.primary` — la page
		// RG TV en compte une trentaine — plantait en
		// « undefined is not an object ».
		colors: THEMES[ctx.theme as ThemeType]?.colors ?? THEMES.roy.colors,
	};
}
