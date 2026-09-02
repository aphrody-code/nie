// Barrel central — `@rosegriffon/ui`
// Réexporte les 55 composants shadcn (style new-york) + le helper `cn`.
// Imports subpath alternatifs disponibles via `@rosegriffon/ui/<nom>` (cf. exports.package.json).

export { cn } from "./lib/utils";

// Identifiants AdSense : réexportés depuis le module PUR, pas depuis
// `components/adsense` (« use client »), pour rester lisibles par un composant
// serveur — les layouts en ont besoin dans `metadata.other`.
export { ADSENSE_CLIENT, ADSENSE_PUBLISHER } from "./lib/adsense";
// Même règle que ci-dessus : une page SERVEUR lit ces badges, ils ne peuvent
// donc pas être exportés depuis le formulaire `"use client"`.
export {
	AVAILABLE_BADGES,
	MAX_BADGES,
	type BadgeProfilAffichable,
} from "./lib/badges-profil";
// Module PUR, exporté depuis `lib/` et jamais depuis le composant client :
// une route serveur lit ces constantes (cf. l'en-tête de `lib/galerie-cdn.ts`).
export {
	CATEGORIES_GALERIE,
	GALERIE_PAR_PAGE,
	ROUTE_GALERIE,
	lireReponseGalerie,
	urlBanniereAffichable,
	urlPageGalerie,
	type IllustrationGalerie,
	type PageGalerie,
} from "./lib/galerie-cdn";

// Hooks
export { useIsMobile, useBreakpoint, BREAKPOINTS } from "./hooks/use-mobile";
export { useMediaQuery } from "./hooks/use-media-query";
export { useSwipe } from "./hooks/use-swipe";

export * from "./components/account";
export { CarteJoueur, type CarteJoueurProps } from "./components/profil/carte-joueur";
export * from "./components/accordion";
export * from "./components/adsense";
export * from "./components/admin-page-header";
export * from "./components/admin-sidebar";
export * from "./components/alert-dialog";
export * from "./components/alert";
export * from "./components/aspect-ratio";
export * from "./components/avatar";
export * from "./components/badge";
export * from "./components/brand-icons";
export * from "./components/breadcrumb";
export * from "./components/button";
export * from "./components/button-group";
export * from "./components/calendar";
export * from "./components/card";
export * from "./components/carousel";
export * from "./components/chart";
export * from "./components/checkbox";
export * from "./components/collapsible";
export * from "./components/command";
export * from "./components/context-menu";
export * from "./components/dashboard-grid";
export * from "./components/dashboard-metric";
export * from "./components/dashboard-stats-card";
export * from "./components/data-table";

export * from "./components/date-picker";
export * from "./components/dialog";
export * from "./components/drawer";
export * from "./components/dropdown-menu";
export * from "./components/empty";
export * from "./components/fab";
export * from "./components/field";
export * from "./components/file-uploader";
export * from "./components/form";
export * from "./components/hover-card";
export * from "./components/input";
export * from "./components/input-group";
export * from "./components/input-otp";
export * from "./components/item";
export * from "./components/kbd";
export * from "./components/label";
export * from "./components/menubar";
export * from "./components/multi-select";
export * from "./components/native-select";
export * from "./components/navigation-bar";
export * from "./components/navigation-menu";
export * from "./components/navigation-rail";
export * from "./components/pagination";
export * from "./components/pagination-controls";
export * from "./components/popover";
export * from "./components/progress";
export * from "./components/radio-group";
export * from "./components/recent-list-card";
export * from "./components/resizable";
export * from "./components/responsive-dialog";
export * from "./components/scroll-area";
export * from "./components/select";
export * from "./components/separator";
export * from "./components/sheet";
export * from "./components/sidebar";
export * from "./components/skeleton";
export * from "./components/slider";
export * from "./components/sonner";
export * from "./components/spinner";
export * from "./components/storage-image";
export * from "./components/switch";
export * from "./components/table";
export * from "./components/tabs";
export * from "./components/textarea";
export * from "./components/theme-provider";
export * from "./components/theme-toggle";
export * from "./components/toggle";
export * from "./components/toggle-group";
export * from "./components/tooltip";

// Lib & Themes
export * from "./lib/themes";
export * from "./lib/utils";
