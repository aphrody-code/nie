import { GameCanvas } from "@niers/inacord-ui";
import { useState } from "react";
import { AVATAR, EXPLORER, MEDIA, SETTINGS } from "../entries";

const CANVAS = { w: 1280, h: 720 };

const MENU_ITEMS: ReadonlyArray<{ label: string; destination?: string }> = [
	{ label: "Composition d'équipe", destination: AVATAR },
	{ label: "Objets", destination: MEDIA },
	{ label: "Marque-pages d'informations", destination: EXPLORER },
	{ label: "Inacord" },
	{ label: "Fichier de données", destination: EXPLORER },
	{ label: "Adversaires" },
	{ label: "Aide" },
	{ label: "Options", destination: SETTINGS },
	{ label: "Sauvegarder" },
];

export function MenuPrincipal({
	onChoisir,
}: {
	vue: string;
	onChoisir: (vue: string) => void;
	etat: unknown;
	pret: boolean;
	panne: boolean;
}) {
	const [selection, setSelection] = useState(0);
	const select = (index: number) => {
		setSelection(index);
		const destination = MENU_ITEMS[index]?.destination;
		if (destination) onChoisir(destination);
	};

	return (
		<GameCanvas canvas={CANVAS} fond="#000">
			<main
				aria-label="Menu principal"
				style={{
					width: "100%",
					height: "100%",
					boxSizing: "border-box",
					padding: "0 70px 48px",
					background: "#121830",
					color: "#ecf1f8",
					fontFamily: "var(--jeu-police, system-ui, sans-serif)",
				}}
			>
				<header
					style={{
						height: 69,
						margin: "0 -70px 30px",
						padding: "0 38px",
						display: "flex",
						alignItems: "center",
						background: "#143c82",
						fontSize: 44,
						fontWeight: 300,
						letterSpacing: "-1.5px",
					}}
				>
					MENU PRINCIPAL
				</header>
				<div role="menu" aria-activedescendant={`main-menu-item-${selection}`}>
					{MENU_ITEMS.map((item, index) => {
						const active = index === selection;
						return (
							<button
								id={`main-menu-item-${index}`}
								key={item.label}
								type="button"
								role="menuitem"
								aria-current={active ? "true" : undefined}
								onFocus={() => setSelection(index)}
								onClick={() => select(index)}
								onKeyDown={(event) => {
									if (event.key === "ArrowDown") {
										event.preventDefault();
										setSelection((index + 1) % MENU_ITEMS.length);
									}
									if (event.key === "ArrowUp") {
										event.preventDefault();
										setSelection((index - 1 + MENU_ITEMS.length) % MENU_ITEMS.length);
									}
								}}
								style={{
									display: "block",
									width: "100%",
									height: 59,
									marginBottom: 9,
									padding: "0 0 0 40px",
									border: 0,
									borderLeft: active ? "7px solid #70e7ff" : "7px solid transparent",
									background: active ? "#397ad0" : "#121830",
									boxShadow: active ? "inset 0 1px rgb(255 255 255 / 20%)" : "none",
									color: "#ecf1f8",
									font: "300 43px/1 var(--jeu-police, system-ui, sans-serif)",
									letterSpacing: "-1.7px",
									textAlign: "left",
									cursor: "pointer",
								}}
							>
								{item.label}
							</button>
						);
					})}
				</div>
			</main>
		</GameCanvas>
	);
}
