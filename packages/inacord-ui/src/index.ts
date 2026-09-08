/**
 * `@niers/inacord-ui` — l'interface partagee d'Inacord et de nie.
 *
 * Un composant de ce paquet ne connait pas son hote : il demande sa source par
 * `useAssetSource()` et ce qu'elle sait faire par `useCapacites()`. C'est la condition pour que
 * le meme code tourne dans une fenetre Tauri et dans un navigateur.
 */
export {
	AssetSourceProvider,
	type ContexteSource,
	useAssetSource,
	useCapacites,
	useErreurSource,
} from "./source";

// --- Coquilles : la direction artistique du jeu ------------------------------------------
//
// Two visual environments are mounted by two hosts: measured game surfaces for nie and Inacord
// for the desktop application. These primitives draw shapes only and own no data source or host.
// Their colors live in `shell/game-tokens.css`, measured against the archived reference.
export {
	Badge,
	Callout,
	HeaderBanner,
	SidePanel,
	SkewTile,
	TileRow,
	TitleBand,
	VersionChip,
} from "./shell/main-menu";
export {
	HexBackdrop,
	type Message,
	MessageThread,
	type Onglet,
	PhoneFrame,
	RoomList,
	type Salon,
	TabBar,
} from "./shell/inacord";

// --- L'ecran de menu principal : ses formes, et le rendu d'un layout exporte ---------------
//
// Les formes (`menu-screen`) sont posees par l'appelant en coordonnees du canevas ; le layout
// (`game-layout` + `layout-render`) vient du jeu et n'est jamais reecrit a la main. Les deux se
// montent dans le MEME `GameCanvas`, donc dans le meme repere.
export {
	Banniere,
	CanvasItem,
	CenterPlate,
	CornerChip,
	GLYPHES,
	HeroPanel,
	IconTile,
	KeyCap,
	type NomGlyphe,
	NoticeCard,
	RibbonBand,
	TileStrip,
} from "./shell/menu-screen";
// La geometrie de l'ecran, MESUREE sur une capture du jeu (`scripts/validation/
// measure-mainmenu.py`). Elle est exportee parce que l'appelant pose les positions : sans elle,
// il les reinventerait, et c'est exactement ce qui a produit un ecran ou tout etait a peu pres
// au bon endroit sans qu'un seul nombre soit rattachable a une mesure.
export {
	ANGLE_TUILE_DEG,
	biseau,
	type Boite,
	BOITES,
	ECART_TUILE,
	FOND_MENU,
	LARGEUR_TUILE,
	largeurTuile,
	PENTE_PANNEAU,
	PENTE_TUILE,
} from "./shell/main-menu-geometry";
export {
	auCentreParDefaut,
	type BilanLayout,
	bilanLayout,
	type CanvasLayout,
	cheminVfsSprite,
	dansCanvas,
	echellePourZone,
	estMuet,
	type LayoutJeu,
	lireLayout,
	type ObjetLayout,
	objetsTries,
	type SegmentTexte,
	segmentsTexte,
	type SlotTexte,
	type SpriteLayout,
	styleObjet,
	tailleObjet,
	texteNu,
	type TransformLayout,
} from "./shell/game-layout";
export {
	GameCanvas,
	LayoutRender,
	type ProprietesLayout,
	useEchelleCanvas,
} from "./shell/layout-render";

// --- La compatibilite Next, pour les composants venus du wiki ------------------------------
//
// 136 composants d'Azalee ont ete migres ici le 2026-09-06. Ils portaient 143 imports de
// `next/*` — mesures : `next/link` 61 fois, `next/image` 53, `next/navigation` 27 — et ce
// paquet est monte par DEUX hotes dont aucun n'est Next. Trois adaptateurs les remplacent, et
// `FournisseurNavigation` est ce que l'hote installe pour que `Link` navigue a sa maniere :
// par etat sous nie, par le navigateur ailleurs.
export {
	FournisseurNavigation,
	Image,
	Link,
	usePathname,
	useRouter,
	useSearchParams,
} from "./compat/next";

// --- Les ecrans du jeu : FILTRES, barre d'onglets, guides de touches, tuiles ----------------
//
// Reconstruits sur les captures de `data/menu/` (main_menu, filters_*, options, player_roster).
// Ils consomment les classes `game-*` de `shell/game-screens.css`, engendree depuis Rust.
export * from "./components/game";
export { AuraCard, type AuraCardImage, type AuraCardProps } from "./components/wiki/wiki/AuraCard";
export {
	ElementIcon,
	type ElementIconImage,
	type ElementIconProps,
	type ElementIconSize,
} from "./components/wiki/wiki/ElementIcon";
export {
	SearchResultHighlight,
	type SearchHighlightPart,
	type SearchResultHighlightProps,
} from "./components/wiki/wiki/SearchResultHighlight";

// --- L'ecran des Options : les reglages d'Inacord, dans l'ecran du jeu ----------------------
//
// Le modele (`settings-model`) est la seule liste des reglages, avec les identifiants du
// magasin partage (`lib/settings`). L'ecran demande `useCapacites()` et cache ce que l'hote ne
// sait pas honorer ; l'hote monte `useApplySettings()` a sa racine pour que ce qui est regle
// change quelque chose.
export {
	cycleValue,
	formatValue,
	isSettingVisible,
	LOCALE_OPTIONS,
	SETTING_DEFINITIONS,
	SETTING_FAMILIES,
	type SettingDefinition,
	type SettingFamily,
	type SettingId,
	type SettingOption,
	visibleFamilies,
	visibleSettings,
} from "./components/settings/settings-model";
export { SettingsScreen } from "./components/settings/SettingsScreen";
export { SettingRow } from "./components/settings/SettingRow";
export { SettingList } from "./components/settings/SettingList";
export {
	getSettings,
	resetSettings,
	resolveTheme,
	type Settings,
	useApplySettings,
	useSettings,
} from "./components/settings/use-settings";
export {
	type ListDensity,
	type Locale,
	type GameLocale,
	GAME_LOCALES,
	SETTINGS_DEFAULTS,
	SETTINGS_STORAGE_KEY,
	setSettings,
	type ThemeMode,
} from "./lib/settings";
export {
	type NativeTextMatches,
	type NativeTextOccurrence,
	type NativeTextResolver,
	fetchNativeText,
	uniqueNativeText,
	useNativeText,
} from "./lib/native-text";
