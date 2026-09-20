/** Layered startup and menu built from VFS assets, shared geometry, and explicit incomplete states. */
import { createStandardGamepadMenuSampler } from "@niers/inacord-ui/shell/menu-interaction";
import { emitNativeCommand } from "@niers/inacord-ui/lib/native-command";
import type { SanteApi as SiteHealth } from "@niers/asset-source/nie-site";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AVATAR, BANK, GALLERY, SETTINGS, SHOP, menuEntries } from "../entries";
import { bindMenuActions } from "../game/menu-actions";
import {
	advanceOpeningPhase,
	OPENING_FRAMES,
	type OpeningEvent,
	type OpeningPhase,
} from "../game/opening-sequence";
import { SubmenuModal } from "../components/SubmenuModal";
import { KizunaTownMultiplayer } from "../components/KizunaTownMultiplayer";
import { MainMenu } from "./MainMenu";
import { OpeningVisual } from "./OpeningVisual";
import { WASM_MODE_LABELS, type WasmMode } from "./WasmGameSurface";
import "./opening.css";

export interface GameProps {
	gamepadSampler?: ReturnType<typeof createStandardGamepadMenuSampler>;
	phase: OpeningPhase;
	onPhaseChange: (phase: OpeningPhase) => void;
	onOpenBank: () => void;
	onOpenGallery: () => void;
	onOpenShop: () => void;
	onOpenAvatar: () => void;
	onOpenSettings: () => void;
	onOpenMedia?: () => void;
	onOpenExplorer?: () => void;
	onOpenEditor?: () => void;
	onOpenSearch?: () => void;
	onOpenData?: () => void;
	onSelectMode?: (mode: WasmMode) => void;
	onOpenModes?: (slug?: string) => void;
	onOpenSave?: () => void;
	onOpenTeam?: () => void;
	startupReady?: boolean;
	health?: SiteHealth | null;
	startupFailed?: boolean;
	onRetryStartup?: () => void;
}

/** Runs the VFS/component startup sequence before mounting the layered menu. */
export function Game({
	gamepadSampler: suppliedGamepadSampler,
	phase,
	onPhaseChange,
	onOpenBank,
	onOpenGallery,
	onOpenShop,
	onOpenAvatar,
	onOpenSettings,
	onSelectMode,
	onOpenModes,
	onOpenSave,
	onOpenTeam,
	startupReady = false,
	health = null,
	startupFailed = false,
	onRetryStartup,
}: GameProps) {
	const localGamepadSampler = useRef(createStandardGamepadMenuSampler());
	const gamepadSampler = suppliedGamepadSampler ?? localGamepadSampler.current;
	const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
	const [isKizunaTownOpen, setIsKizunaTownOpen] = useState(false);
	const advance = useCallback((event: OpeningEvent) => {
		onPhaseChange(advanceOpeningPhase(phase, event));
	}, [phase, onPhaseChange]);

	const hostActions = useMemo(() => bindMenuActions(menuEntries(null), {
		// La Banque EST « Votre équipe », et elle l'était déjà.
		//
		// L'appariement ne se fait pas par `MainMenu.nativeBinding` mais par la SCÈNE :
		// `menu_scenes/title-menu.json` déclare un contrôle `team` portant
		// `hostActionId: "bank"` et le libellé « Votre équipe », et `NativeMainMenu` lie
		// `actions.find(a => a.id === control.hostActionId)`. L'identifiant attendu ici est
		// donc bien `bank`. Poser `team` le décroche : plus aucun contrôle natif ne le
		// réclame, et la Banque retombe dans `siteActions`, en bouton générique à côté du
		// menu — ce qui ressemble à une correction et est une régression.
		[BANK]: { id: "bank", onActivate: onOpenBank },
		[GALLERY]: { id: "gallery", onActivate: onOpenGallery },
		[SHOP]: { id: "shop", onActivate: onOpenShop },
		[AVATAR]: { id: "avatar", onActivate: onOpenAvatar },
		[SETTINGS]: { id: "settings", onActivate: onOpenSettings },
	}), [onOpenBank, onOpenGallery, onOpenShop, onOpenAvatar, onOpenSettings]);

	const modeSlugs = useMemo(() => ["story_mode", "chronicle_mode", "competition", "bb_stadium", "victory_road"] as const, []);

	const actions = useMemo(() => [
		...hostActions,
		...modeSlugs.map((slug) => ({
			id: `mode-${slug}`,
			label: WASM_MODE_LABELS[slug] ?? slug,
			glyph: "livre" as const,
			onActivate: () => setActiveSubmenu(slug),
			disabled: false,
		})),
		{
			id: "mode-kizuna_town",
			label: "Station Kizuna",
			glyph: "arbre" as const,
			onActivate: () => setIsKizunaTownOpen(true),
			disabled: false,
		},
		{
			id: "mode-information",
			label: "Informations",
			glyph: "livre" as const,
			onActivate: () => setActiveSubmenu("information"),
			disabled: false,
		},
		{
			id: "title-item-10",
			label: "Sauvegarder",
			glyph: "livre" as const,
			onActivate: () => {
				if (onOpenSave) {
					onOpenSave();
				} else {
					setActiveSubmenu("title-item-10");
				}
			},
			disabled: false,
		},
	], [hostActions, modeSlugs, onOpenSave]);

	if (phase === "menu") {
		return (
			<>
				<MainMenu
					actions={actions}
					gamepadSampler={gamepadSampler}
				/>
				{isKizunaTownOpen && (
					<KizunaTownMultiplayer
						onClose={() => setIsKizunaTownOpen(false)}
						onLaunchMatch={(inacode, seed) => {
							setIsKizunaTownOpen(false);
							onSelectMode?.("victory_road");
						}}
					/>
				)}
				{activeSubmenu && (
					<SubmenuModal
						modeSlug={activeSubmenu}
						onClose={() => setActiveSubmenu(null)}
						onLaunchWasm={onSelectMode ? (mode) => {
							setActiveSubmenu(null);
							onSelectMode(mode);
						} : undefined}
						onExploreMode={onOpenModes ? (slug) => {
							setActiveSubmenu(null);
							onOpenModes(slug);
						} : undefined}
						onOpenScreen={(screen) => {
							setActiveSubmenu(null);
							if (screen === "soccer_formation_menu" || screen === "team") {
								(onOpenTeam ?? onOpenBank)();
							} else if (screen === "save_menu" || screen === "save") {
								onOpenSave?.();
							} else if (screen === "chara_bank_menu" || screen === "bank") {
								onOpenBank();
							} else if (screen === "shop_menu" || screen === "shop") {
								onOpenShop();
							} else if (screen === "chara_edit_menu" || screen === "avatar") {
								onOpenAvatar();
							} else if (screen === "gallery_menu" || screen === "gallery") {
								onOpenGallery();
							} else if (screen === "setting_menu" || screen === "settings") {
								onOpenSettings();
							} else if (onOpenModes) {
								onOpenModes(screen);
							}
						}}
					/>
				)}
			</>
		);
	}
	return (
		<OpeningScreen
			key={phase}
			phase={phase}
			onAdvance={advance}
			gamepadSampler={gamepadSampler}
			startupReady={startupReady}
			health={health}
			startupFailed={startupFailed}
			onRetryStartup={onRetryStartup}
		/>
	);
}

function OpeningScreen({
	phase,
	onAdvance,
	gamepadSampler,
	startupReady,
	health,
	startupFailed,
	onRetryStartup,
}: {
	phase: Exclude<OpeningPhase, "menu">;
	onAdvance: (event: OpeningEvent) => void;
	gamepadSampler: ReturnType<typeof createStandardGamepadMenuSampler>;
	startupReady: boolean;
	health: SiteHealth | null;
	startupFailed: boolean;
	onRetryStartup?: () => void;
}) {
	const frame = OPENING_FRAMES[phase];
	const movie = frame.advanceOn === "media-ended";
	const [ready, setReady] = useState(false);
	const onReady = useCallback(() => setReady(true), []);
	const advanced = useRef(false);
	const advanceOnce = useCallback((event: OpeningEvent) => {
		if (advanced.current) return;
		advanced.current = true;
		if (phase === "start" && event === "confirm") {
			emitNativeCommand("data/common/gamedata/menu/obj/title00_04_gamestart.objbin", "CMD_ENTER");
		}
		onAdvance(event);
	}, [onAdvance, phase]);

	useEffect(() => {
		if (phase === "loading") {
			if (startupReady) {
				advanceOnce("resources-ready");
				return;
			}
			const fallbackTimer = window.setTimeout(() => advanceOnce("resources-ready"), 2500);
			return () => window.clearTimeout(fallbackTimer);
		}
		if (!ready || movie || frame.durationMs === null) return;
		const timer = window.setTimeout(() => advanceOnce("timeout"), frame.durationMs);
		return () => window.clearTimeout(timer);
	}, [phase, startupReady, ready, movie, frame.durationMs, advanceOnce]);

	useEffect(() => {
		if (typeof navigator.getGamepads !== "function") return;
		let animationFrame = 0;
		const poll = () => {
			for (const intent of gamepadSampler.sample(navigator.getGamepads())) {
				if (ready && intent.type === "activate" && frame.advanceOn === "confirm") advanceOnce("confirm");
			}
			animationFrame = window.requestAnimationFrame(poll);
		};
		animationFrame = window.requestAnimationFrame(poll);
		return () => window.cancelAnimationFrame(animationFrame);
	}, [ready, frame.advanceOn, advanceOnce, gamepadSampler]);

	return (
		<section
			aria-label={frame.alt}
			aria-live="polite"
			data-opening-phase={phase}
			className={`opening-screen opening-screen--${phase}`}
		>
			<OpeningVisual phase={phase} health={health} failed={startupFailed} onRetry={onRetryStartup} onReady={onReady} onEnded={movie ? () => advanceOnce("media-ended") : undefined}
				onConfirm={frame.advanceOn === "confirm" ? () => advanceOnce("confirm") : undefined}
				onSkip={phase === "loading" ? () => advanceOnce("resources-ready") : undefined} />
		</section>
	);
}
