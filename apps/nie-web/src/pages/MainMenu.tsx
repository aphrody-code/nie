/**
 * The browser main menu, rebuilt from the game's VFS assets in the measured 1280x720 space.
 *
 * The dark vertical list previously shown here was the temporary `nie-app` framebuffer, not
 * the `mainmenu01` reference stored in `data/menu`. This screen therefore uses named regions
 * from the real G4TX atlases and the geometry measured in `main-menu-geometry.ts`. Runtime-only
 * character/team state is deliberately represented by the measured panel shapes until its C++
 * scene bindings are available; no screenshot is used as a background.
 */
import { cheminTextureNommee } from "@niers/asset-source/url-conventions";
import { BOITES, CanvasItem, GameCanvas, useAssetSource } from "@niers/inacord-ui";
import { useMemo, useState } from "react";
import { AVATAR, EXPLORER, MEDIA, SETTINGS } from "../entries";

const CANVAS = { w: 1280, h: 720 } as const;
const MAIN_ATLAS =
	"data/dx11/menu/100_mainmenu/mainmenu90/mainmenu90_02/fr/mainmenu90_02.g4tx";
const HEADER_ICON_ATLAS =
	"data/dx11/menu/100_mainmenu/mainmenu90/mainmenu90_02_2/mainmenu90_02_2.g4tx";
const TAB_ICON_ATLAS =
	"data/dx11/menu/200_icon/16_icon_list_tab/fr/icon_list_tab.g4tx";
const TITLE_ATLAS = "data/dx11/menu/50_title/title02/title02_01/fr/title02_01.g4tx";
const DELUXE_BADGE =
	"data/dx11/menu/220_img/logo_dlc/logo_dlc_deluxe_edition.g4tx";

interface MenuAction {
	label: string;
	region: string;
	destination?: string;
	play?: boolean;
}

type SelectAction = (index: number, action: MenuAction, activate: boolean) => void;

/** Order and regions are the same values used by `nie-game::paint_main_menu_icon_row`. */
const MAIN_ACTIONS: readonly MenuAction[] = [
	{ label: "Match", region: "icon_list_tab_option01", play: true },
	{ label: "Médias", region: "icon_list_tab_help02", destination: MEDIA },
	{ label: "Avatar", region: "icon_list_tab_help03", destination: AVATAR },
	{ label: "Explorer", region: "icon_list_tab_quest01", destination: EXPLORER },
	{ label: "Inacord", region: "icon_list_tab_kizuna01", destination: EXPLORER },
	{ label: "Victory Road", region: "icon_list_tab_vroad01", play: true },
	{ label: "Objets", region: "icon_list_tab_town01", destination: MEDIA },
	{ label: "Fichier de données", region: "icon_list_tab_record01", destination: EXPLORER },
] as const;

const SECONDARY_ACTIONS: readonly MenuAction[] = [
	{ label: "Sauvegarder", region: "icon_menu11_on", destination: EXPLORER },
	{ label: "Options", region: "icon_menu05_on", destination: SETTINGS },
	{ label: "Aide", region: "icon_menu06_on", destination: EXPLORER },
] as const;

function namedTextureUrl(path: string, region: string): string {
	return `/assets${cheminTextureNommee(path, region)}`;
}

function VfsImage({
	path,
	region,
	alt = "",
	style,
}: {
	path: string;
	region: string;
	alt?: string;
	style?: React.CSSProperties;
}) {
	return (
		<img
			src={namedTextureUrl(path, region)}
			alt={alt}
			draggable={false}
			onError={(event) => {
				event.currentTarget.hidden = true;
			}}
			style={{ display: "block", objectFit: "contain", pointerEvents: "none", ...style }}
		/>
	);
}

function MenuTile({
	action,
	index,
	selected,
	onSelect,
}: {
	action: MenuAction;
	index: number;
	selected: boolean;
	onSelect: SelectAction;
}) {
	return (
		<button
			type="button"
			data-main-menu-index={index}
			aria-label={action.label}
			aria-current={selected ? "true" : undefined}
			onFocus={() => onSelect(index, action, false)}
			onClick={() => onSelect(index, action, true)}
			style={{
				position: "absolute",
				left: 109 + index * 135,
				top: selected ? 378 : 383,
				width: 120,
				height: 84,
				padding: 0,
				border: 0,
				clipPath: "polygon(30px 0, 100% 0, calc(100% - 30px) 100%, 0 100%)",
				background: selected
					? "linear-gradient(180deg, #7ebcf0, #3276cc)"
					: "linear-gradient(180deg, #4a8cd4, #1a4696)",
				boxShadow: selected ? "0 0 0 4px #17ecf3, 0 8px 14px rgb(31 93 180 / 45%)" : "none",
				cursor: "pointer",
				zIndex: 30,
			}}
		>
			<VfsImage
				path={TAB_ICON_ATLAS}
				region={action.region}
				style={{ width: 100, height: 67, margin: "8px auto 0" }}
			/>
		</button>
	);
}

function SecondaryTile({
	action,
	index,
	selected,
	onSelect,
}: {
	action: MenuAction;
	index: number;
	selected: boolean;
	onSelect: SelectAction;
}) {
	return (
		<button
			type="button"
			data-main-menu-index={index}
			aria-label={action.label}
			aria-current={selected ? "true" : undefined}
			onFocus={() => onSelect(index, action, false)}
			onClick={() => onSelect(index, action, true)}
			style={{
				position: "absolute",
				left: 424 + (index - MAIN_ACTIONS.length) * 143,
				top: selected ? 526 : 530,
				width: 137,
				height: 91,
				padding: 0,
				border: 0,
				clipPath: "polygon(34px 0, 100% 0, calc(100% - 34px) 100%, 0 100%)",
				background: "linear-gradient(180deg, #4a8cd4, #1a4696)",
				boxShadow: selected ? "0 0 0 4px #17ecf3, 0 8px 14px rgb(31 93 180 / 45%)" : "none",
				cursor: "pointer",
				zIndex: 30,
			}}
		>
			<VfsImage
				path={HEADER_ICON_ATLAS}
				region={action.region}
				style={{ width: 74, height: 74, margin: "8px auto 0" }}
			/>
		</button>
	);
}

export function MenuPrincipal({
	onChoose,
	onPlay,
}: {
	view: string;
	onChoose: (view: string) => void;
	onPlay: () => void;
	health: unknown;
	ready: boolean;
	failed: boolean;
}) {
	const source = useAssetSource();
	const actions = useMemo(() => [...MAIN_ACTIONS, ...SECONDARY_ACTIONS], []);
	const [selection, setSelection] = useState(0);

	const selectAction: SelectAction = (index, action, activate) => {
		setSelection(index);
		if (!activate) return;
		if (action.play) onPlay();
		else if (action.destination) onChoose(action.destination);
	};

	const moveSelection = (delta: number) => {
		const next = (selection + delta + actions.length) % actions.length;
		setSelection(next);
		document.querySelector<HTMLButtonElement>(`[data-main-menu-index="${next}"]`)?.focus();
	};

	return (
		<GameCanvas canvas={CANVAS} fond="#f9fdf9">
			<main
				aria-label="Menu principal"
				tabIndex={-1}
				onKeyDown={(event) => {
					if (event.key === "ArrowRight" || event.key === "ArrowDown") {
						event.preventDefault();
						moveSelection(1);
					}
					if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
						event.preventDefault();
						moveSelection(-1);
					}
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						const action = actions[selection];
						if (action) selectAction(selection, action, true);
					}
				}}
				style={{
					position: "absolute",
					inset: 0,
					overflow: "hidden",
					background:
						"radial-gradient(ellipse at 50% 7%, #ffffff 0 32%, transparent 65%), linear-gradient(180deg, #effaff 0%, #f9fdf9 72%, #fff 100%)",
					fontFamily: "var(--jeu-police, system-ui, sans-serif)",
				}}
			>
				<h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
					Inazuma Eleven: Victory Road
				</h1>

				<CanvasItem x={BOITES.titre.x} y={BOITES.titre.y} largeur={BOITES.titre.l} hauteur={BOITES.titre.h} z={20}>
					<VfsImage path={TITLE_ATLAS} region="logo02" alt="Inazuma Eleven: Victory Road" style={{ width: "100%", height: "100%" }} />
				</CanvasItem>

				<CanvasItem x={8} y={10} largeur={306} hauteur={126} z={22}>
					<div style={{ height: 82, border: "3px solid #34476f", borderRadius: 12, background: "linear-gradient(135deg, #fff44f, #f3fbff 30%, #bcecff)", color: "#764000", padding: "7px 16px", boxSizing: "border-box", fontSize: 15, fontWeight: 800, lineHeight: 1.12 }}>
						Le Victory Road Bêta arrive !
						<div style={{ color: "#0784e8", marginTop: 6, fontSize: 13 }}>Créez votre équipe ultime et visez le sommet !</div>
					</div>
					<div style={{ height: 34, margin: "3px 12px 0", borderRadius: "0 0 20px 20px", background: "#354872", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 35, fontWeight: 800, fontSize: 16 }}>
						<kbd style={{ borderRadius: 5, background: "#454545", padding: "2px 7px" }}>X</kbd> Informations
					</div>
				</CanvasItem>

				<CanvasItem x={1043} y={17} largeur={205} z={22}>
					<div style={{ color: "#61bdf1", fontSize: 20, fontWeight: 700, textAlign: "right" }}>ver. 7.1.2</div>
				</CanvasItem>
				<CanvasItem x={1000} y={93} largeur={250} z={22}>
					<div style={{ color: "#009fe9", fontSize: 21, fontWeight: 800, textAlign: "right" }}><kbd style={{ color: "#fff", background: "#4a4a4a", borderRadius: 4, padding: "2px 7px", fontSize: 14 }}>Alt</kbd>　Inazuma Post</div>
				</CanvasItem>

				<CanvasItem x={0} y={BOITES.panneaux.y} largeur={519} hauteur={BOITES.panneaux.h} z={10}>
					<button type="button" onClick={() => onChoose(AVATAR)} style={{ width: "100%", height: "100%", border: 0, padding: 0, clipPath: "polygon(0 0, 81% 0, 100% 100%, 0 100%)", background: "linear-gradient(105deg, rgb(109 223 250 / 70%), rgb(222 253 255 / 75%))", color: "#fff", cursor: "pointer", position: "relative" }}>
						<VfsImage path={MAIN_ATLAS} region="icon_header_avatar01" style={{ position: "absolute", left: 155, top: 8, width: 250, height: 170, opacity: 0.18 }} />
						<span style={{ position: "absolute", left: 28, bottom: 2, fontSize: 38, letterSpacing: "0.08em", fontWeight: 700 }}>AVATAR</span>
					</button>
				</CanvasItem>
				<CanvasItem x={747} y={BOITES.panneaux.y} largeur={533} hauteur={BOITES.panneaux.h} z={10}>
					<button type="button" onClick={onPlay} style={{ width: "100%", height: "100%", border: 0, padding: 0, clipPath: "polygon(19% 0, 100% 0, 100% 100%, 0 100%)", background: "linear-gradient(255deg, rgb(83 228 97 / 65%), rgb(223 255 224 / 72%))", color: "#fff", cursor: "pointer", position: "relative" }}>
						<span style={{ position: "absolute", right: 28, top: 14, fontSize: 18, letterSpacing: "0.08em" }}>NIVEAU DE L’ÉQUIPE</span>
						<span style={{ position: "absolute", right: 210, top: 43, fontSize: 38 }}>3</span>
						<span style={{ position: "absolute", right: 28, bottom: 2, fontSize: 38, letterSpacing: "0.06em", fontWeight: 700 }}>VOTRE ÉQUIPE</span>
					</button>
				</CanvasItem>

				<CanvasItem x={518} y={272} largeur={262} hauteur={82} z={24}>
					<div style={{ height: "100%", textAlign: "center", color: "#0b9ee8", fontWeight: 900, fontSize: 22, letterSpacing: "0.08em" }}>
						VICTOIRES
						<div style={{ marginTop: 2, height: 40, clipPath: "polygon(9% 0, 100% 0, 91% 100%, 0 100%)", background: "linear-gradient(180deg, #dff2ff, #9bc9f4)", color: "#0750d8", fontSize: 35, lineHeight: "40px" }}>0</div>
					</div>
				</CanvasItem>

				{MAIN_ACTIONS.map((action, index) => (
					<MenuTile key={action.region} action={action} index={index} selected={selection === index} onSelect={selectAction} />
				))}

				<CanvasItem x={594} y={459} largeur={438} hauteur={56} z={25}>
					<div style={{ width: "100%", height: "100%", clipPath: "polygon(5% 0, 100% 0, 95% 100%, 0 100%)", background: "linear-gradient(180deg, #70b6f2, #2d78d4)", border: "4px solid #10e6ee", boxSizing: "border-box", color: "#fff", display: "flex", justifyContent: "space-around", alignItems: "center", fontSize: 19, fontWeight: 900, textShadow: "0 1px 2px #19569d" }}>
						<span>VICTOIRES<br /><b>0</b></span><span>SOLO<br /><b>0</b></span><span>EN LIGNE<br /><b>0</b></span>
					</div>
				</CanvasItem>

				{SECONDARY_ACTIONS.map((action, offset) => {
					const index = MAIN_ACTIONS.length + offset;
					return <SecondaryTile key={action.region} action={action} index={index} selected={selection === index} onSelect={selectAction} />;
				})}

				{source.urlTexture ? (
					<CanvasItem x={41} y={603} largeur={239} hauteur={50} z={22}>
						<img src={source.urlTexture(DELUXE_BADGE)} alt="Deluxe Edition" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
					</CanvasItem>
				) : null}
				<CanvasItem x={1035} y={563} largeur={225} z={22}>
					<div style={{ display: "grid", gap: 3 }}>
						{[200, 300, 400].map((id) => (
							<img key={id} src={source.urlTexture?.(`data/dx11/menu/220_img/logo_dlc/fr/logo_dlc_${id}.g4tx`)} alt="" draggable={false} style={{ width: 225, height: 32, objectFit: "contain" }} />
						))}
					</div>
				</CanvasItem>
				<CanvasItem x={1042} y={675} largeur={225} z={22}>
					<div style={{ color: "#5db9ea", fontSize: 17, fontWeight: 700, textAlign: "right" }}>©2025 LEVEL5 Inc.</div>
				</CanvasItem>
			</main>
		</GameCanvas>
	);
}
