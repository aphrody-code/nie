/** Programmatic view of the generated NIE/Aphrody design-token contract. */
export const spaceuiTokens = {
	colors: {
		abyssBackground: "oklch(0.1963 0.0242 280.23)",
		nightBackground: "oklch(0.3000 0.0726 258.02)",
		deepBackground: "oklch(0.3800 0.0888 258.02)",
		mediumBackground: "oklch(0.4600 0.0968 258.02)",
		amberAccent: "oklch(0.8400 0.1273 94.17)",
		brickAccent: "oklch(0.5800 0.1600 18.35)",
		azureAccent: "oklch(0.5800 0.1291 258.02)",
		cyanAccent: "oklch(0.8000 0.0968 258.02)",
		turquoiseAccent: "oklch(0.7000 0.1533 258.02)",
		iceSurface: "oklch(0.9400 0.0282 258.02)",
		mistSurface: "oklch(0.8800 0.0403 258.02)",
		chalkSurface: "oklch(0.8800 0.0263 70.41)",
		ashSurface: "oklch(0.7000 0.0374 46.43)",
		pinkSurface: "oklch(0.6400 0.0435 337.07)",
		brightText: "oklch(0.9850 0.0035 59.65)",
		softText: "oklch(0.6400 0.1049 258.02)",
		clearSky: "oklch(0.9750 0.0041 59.65)",
		mistSky: "oklch(0.8900 0.0363 258.02)",
		deepNight: "oklch(0.3229 0.0807 258.02)",
		tileTop: "oklch(0.5000 0.1049 258.02)",
		tileBottom: "oklch(0.3900 0.0968 258.02)",
		tileBorder: "oklch(0.4500 0.0968 258.02)",
		activeTileTop: "oklch(0.5800 0.1210 258.02)",
		activeTileBottom: "oklch(0.4600 0.1614 258.02)",
		bluePlate: "oklch(0.4200 0.1533 258.02)",
		goldEdge: "oklch(0.7800 0.1485 94.17)",
		inacordPanel: "oklch(0.2900 0.0242 280.23)",
		inacordLightPanel: "oklch(0.3800 0.0484 258.02)",
		inacordAccent: "oklch(0.7000 0.0888 258.02)",
	},
	geometry: {
		bevel: "14px",
		radius: "4px",
		borderWidth: "2px",
	},
	spacing: {
		xs: "4px",
		sm: "8px",
		md: "16px",
		lg: "24px",
		xl: "40px",
	},
	motion: {
		fast: "120ms",
		medium: "220ms",
		easing: "cubic-bezier(0.2, 0, 0, 1)",
	},
	typography: {
		titleWeight: 800,
		titleTracking: "0.02em",
		labelTracking: "0.06em",
	},
} as const;

export type SpaceuiTokens = typeof spaceuiTokens;
export default spaceuiTokens;
