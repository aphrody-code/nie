/**
 * Le dialogue FILTRES du jeu, entier.
 *
 * Reproduit `data/menu/filters_elements.png` et ses sept sœurs (`filters_position.png`,
 * `filters_rarity.png`, `filters_appearance.png`, `filters_foot.png`, `filters_bonus.png`,
 * `filters_team_role.png`, `filters_team.png`) : le titre « FILTRES », la rangée d'icônes des
 * familles avec « W » et « C » pour en changer, le nom de la famille sous la rangée, une grille
 * de cases à cocher en deux colonnes ouverte par « Tout », le bouton « V Tout » en bas à droite
 * du cadre, puis le pied « Tab Réinitialiser · Alt Confirmer · 13/13 ».
 *
 * ## Le modèle de sélection
 *
 * Une famille porte une liste de valeurs retenues ; **vide veut dire « Tout »** — aucun filtre,
 * et le jeu montre alors toutes les cases cochées. Une famille `single` (la seule forme que le
 * serveur sert aujourd'hui : `ext=`, `cpk=`, `tri=`) ne retient qu'une valeur ; cocher une
 * autre case remplace la première, décocher la case cochée revient à « Tout ». Une famille
 * `multi` retient plusieurs valeurs, et décocher la dernière restante revient aussi à « Tout ».
 *
 * ## Les touches — toutes branchées, ou pas dessinées
 *
 * `R` remet tout à « Tout », `Entrée` et `Alt` confirment, `V` bascule la famille courante,
 * `W`/`C` changent de famille, `Escape` ferme sans appliquer, et les flèches parcourent la
 * grille en colonnes comme dans le jeu (la lecture y est verticale : Vent, Feu | Forêt,
 * Montagne). Chaque guide affiché est un bouton qui fait la même chose à la souris.
 *
 * Sur le Web, `Tab` et `Maj+Tab` gardent leur contrat d'accessibilité et restent enfermés dans
 * le dialogue. Le raccourci natif est donc exposé sur `R`, à côté du bouton visible, au lieu de
 * rendre les commandes du panneau inaccessibles au clavier.
 */
import { type CSSProperties, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { GameCheck } from "./GameCheck";
import { GameCountBadge } from "./GameCountBadge";
import { GameKeyHint, cx } from "./GameKeyHint";
import { GamePanel } from "./GamePanel";
import { type GameTab, GameTabStrip } from "./GameTabStrip";
import { isEditableTarget, keyMatches } from "./keys";

export interface GameFilterOption {
	value: string;
	label: ReactNode;
	/** Sous-titre ou explication sur la 2e ligne, comme dans filters_bonus.png. */
	description?: ReactNode;
	/** Section optionnelle pour regrouper les options avec un titre dédié. */
	section?: string;
	/** La pastille devant le libellé : l'icône de l'élément, la bannière de rareté. */
	icon?: ReactNode;
	/** Un compte à droite du libellé — ce que l'index sait de cette valeur. */
	count?: number;
}

export interface GameFilterFamily extends GameTab {
	options: readonly GameFilterOption[];
	/** `single` par défaut : le serveur ne sert qu'une valeur par paramètre. */
	mode?: "single" | "multi";
	/** Le filigrane du fond quand cette famille est affichée. */
	watermark?: ReactNode;
	/** Un contenu libre sous la grille — les réglages qui ne sont pas des cases. */
	extra?: ReactNode;
}

/** Les valeurs retenues par famille. Une famille absente ou vide = « Tout ». */
export type GameFilterValue = Record<string, readonly string[]>;

/** « Tout » est-il coché pour cette famille ? */
function isAll(value: GameFilterValue, family: string): boolean {
	return (value[family] ?? []).length === 0;
}

/** Une option est-elle cochée ? Sous « Tout », toutes le sont, comme dans le jeu. */
function isChecked(value: GameFilterValue, family: GameFilterFamily, option: string): boolean {
	const selected = value[family.id] ?? [];
	return selected.length === 0 || selected.includes(option);
}

/** Le nouvel état après un clic sur une option, selon le mode de la famille. */
function toggle(value: GameFilterValue, family: GameFilterFamily, option: string, checked: boolean): GameFilterValue {
	const selected = value[family.id] ?? [];
	let next: string[];
	if (family.mode === "multi") {
		// Sous « Tout », décocher une option retient toutes les autres.
		const base = selected.length === 0 ? family.options.map((o) => o.value) : [...selected];
		next = checked ? [...base, option] : base.filter((v) => v !== option);
		if (next.length >= family.options.length) next = [];
	} else {
		next = checked && !(selected.length === 1 && selected[0] === option) ? [option] : [];
		// Sous « Tout », cliquer une case déjà cochée la retient seule : c'est le geste attendu
		// d'une liste où tout est coché — on veut celle-là, pas les autres.
		if (selected.length === 0 && !checked) next = [option];
	}
	return { ...value, [family.id]: next };
}

export function GameFilterPanel({
	families,
	value,
	onConfirm,
	onClose,
	onReset,
	count,
	total,
	countUnit,
	countIcon,
	title = "FILTRES",
	initialFamily,
	className,
	style,
}: {
	families: readonly GameFilterFamily[];
	/** L'état appliqué. Le panneau travaille sur un brouillon jusqu'à « Confirmer ». */
	value: GameFilterValue;
	onConfirm: (value: GameFilterValue) => void;
	/** Fermer sans appliquer (`Escape`, ou un clic hors du panneau chez l'appelant). */
	onClose?: () => void;
	/** Synchronise les contrôles libres rendus par `family.extra` avec le reset du brouillon. */
	onReset?: () => void;
	/** Le compte retenu par le BROUILLON, si l'appelant sait le mesurer ; sinon par la valeur appliquée. */
	count?: number;
	total?: number;
	countUnit?: string;
	countIcon?: ReactNode;
	title?: ReactNode;
	initialFamily?: string;
	className?: string;
	/** La taille du dialogue dans la page — une géométrie de l'appelant, jamais une couleur. */
	style?: CSSProperties;
}) {
	const titleId = useId();
	const [draft, setDraft] = useState<GameFilterValue>(value);
	const [familyId, setFamilyId] = useState(initialFamily ?? families[0]?.id ?? "");
	// Le curseur : `-1` sur « Tout », sinon l'index de l'option. Un par famille affichée.
	const [cursor, setCursor] = useState(-1);
	const inputs = useRef<(HTMLInputElement | null)[]>([]);
	const panel = useRef<HTMLElement | null>(null);
	const previousFocus = useRef<HTMLElement | null>(null);

	// Un nouvel état appliqué de l'extérieur (l'URL, un « Effacer ») remplace le brouillon.
	useEffect(() => setDraft(value), [value]);

	const family = useMemo(() => families.find((f) => f.id === familyId) ?? families[0], [families, familyId]);
	const rows = family ? Math.ceil(family.options.length / 2) : 0;

	// Au montage, le focus entre dans le dialogue sur « Tout » : c'est là que le jeu pose son curseur.
	useEffect(() => {
		previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		inputs.current[0]?.focus();
		return () => {
			const target = previousFocus.current;
			if (target?.isConnected) target.focus();
		};
	}, []);

	useEffect(() => {
		// Le curseur suit le focus, et le focus suit le curseur : l'un ou l'autre peut bouger en
		// premier (souris, flèches), les deux racontent la même chose. Cette synchronisation vient
		// après la capture du focus extérieur pour ne jamais mémoriser une case du dialogue.
		inputs.current[cursor + 1]?.focus();
	}, [cursor]);

	if (!family) return null;

	const setAll = (all: boolean) => {
		// Décocher « Tout » ne peut pas retenir « rien » — vide VEUT dire tout — donc la
		// première option reste cochée, et le lecteur en choisit une autre s'il le veut.
		const first = family.options[0]?.value;
		setDraft((d) => ({ ...d, [family.id]: all || first === undefined ? [] : [first] }));
	};
	const toggleAll = () => setAll(!isAll(draft, family.id));
	const reset = () => {
		setDraft(Object.fromEntries(families.map((f) => [f.id, []])));
		onReset?.();
	};
	const restorePreviousFocus = () => {
		const target = previousFocus.current;
		if (target?.isConnected) target.focus();
	};
	const confirm = () => {
		onConfirm(draft);
		restorePreviousFocus();
	};
	const close = () => {
		onClose?.();
		restorePreviousFocus();
	};
	const step = (delta: number) => {
		const i = families.findIndex((f) => f.id === family.id);
		const next = families[(i + delta + families.length) % families.length];
		if (next) {
			setFamilyId(next.id);
			setCursor(-1);
		}
	};

	const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
		const n = family.options.length;
		const move = (to: number) => {
			event.preventDefault();
			setCursor(Math.max(-1, Math.min(n - 1, to)));
		};
		// Tab keeps the modal focus trap; Enter/Alt confirm and Escape closes from every target.
		// Editable controls get their remaining keys before the game's grid navigation so arrows
		// retain their native caret/number-step behaviour and ordinary letters remain editable.
		switch (event.key) {
			case "Tab": {
				const focusable = Array.from(
					panel.current?.querySelectorAll<HTMLElement>(
						'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]',
					) ?? [],
				).filter((element) => element.tabIndex >= 0);
				const first = focusable[0];
				const last = focusable.at(-1);
				if (event.shiftKey && document.activeElement === first && last) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && document.activeElement === last && first) {
					event.preventDefault();
					first.focus();
				}
				return;
			}
			case "Enter":
			case "Alt":
				event.preventDefault();
				confirm();
				return;
			case "Escape":
				event.preventDefault();
				close();
				return;
			default:
				break;
		}
		if (isEditableTarget(event.target) && !(event.target instanceof HTMLInputElement && event.target.type === "checkbox")) return;
		switch (event.key) {
			case "ArrowDown":
				// De « Tout » on descend sur la première ; en bas d'une colonne on s'arrête.
				if (cursor === -1) return move(0);
				return (cursor + 1) % rows === 0 ? move(cursor) : move(cursor + 1);
			case "ArrowUp":
				if (cursor === -1) return move(-1);
				return cursor % rows === 0 ? move(-1) : move(cursor - 1);
			case "ArrowRight":
				if (cursor === -1) return step(1);
				return move(cursor + rows < n ? cursor + rows : cursor);
			case "ArrowLeft":
				if (cursor === -1) return step(-1);
				return move(cursor - rows >= 0 ? cursor - rows : cursor);
			default:
				break;
		}
		if (keyMatches(event, "r")) {
			event.preventDefault();
			reset();
		} else if (keyMatches(event, "v")) {
			event.preventDefault();
			toggleAll();
		} else if (keyMatches(event, "w")) {
			event.preventDefault();
			step(-1);
		} else if (keyMatches(event, "c")) {
			event.preventDefault();
			step(1);
		}
	};

	// La grille se lit en colonnes : l'option `i` est à la ligne `i % rows`, colonne `i / rows`.
	const grid = family.options.map((option, i) => ({ option, i, row: i % rows, col: Math.floor(i / rows) }));

	return (
		<GamePanel
			role="dialog"
			modal
			title={title}
			titleId={titleId}
			className={cx("game-filter-panel", className)}
			style={style}
			panelRef={(el) => {
				panel.current = el;
			}}
			onKeyDown={onKeyDown}
			header={
				<GameTabStrip
					ariaLabel="Familles de filtres"
					tabs={families}
					value={family.id}
					onChange={(id) => {
						setFamilyId(id);
						setCursor(-1);
					}}
				/>
			}
			watermark={family.watermark}
			footer={
				<>
					<GameKeyHint keyLabel="Tab" onActivate={reset} className="game-button-secondary">
						Réinitialiser
					</GameKeyHint>
					<GameKeyHint keyLabel="Alt" onActivate={confirm} className="game-button-primary">
						Confirmer
					</GameKeyHint>
					{count !== undefined ? (
						<span style={{ marginLeft: "auto" }}>
							<GameCountBadge count={count} total={total} unit={countUnit} icon={countIcon} />
						</span>
					) : null}
				</>
			}
		>
			<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
				{/* Bandeau d'en-tête de catégorie : (W) Nom de la famille (C) */}
				<div
					className="game-filter-panel__category-banner"
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						gap: 16,
						margin: "2px 0 8px",
					}}
				>
					<GameKeyHint keyLabel="W" onActivate={() => step(-1)} className="game-button-secondary">
						W
					</GameKeyHint>
					<span
						className="game-filter-panel__category-name"
						style={{
							fontSize: "1.2rem",
							fontWeight: 700,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: "var(--screen-panel-title, var(--jeu-texte-vif))",
						}}
					>
						{family.label}
					</span>
					<GameKeyHint keyLabel="C" onActivate={() => step(1)} className="game-button-secondary">
						C
					</GameKeyHint>
				</div>

				<GameCheck
					checked={isAll(draft, family.id)}
					onChange={(all) => setAll(all)}
					cursor={cursor === -1}
					tabIndex={cursor === -1 ? 0 : -1}
					inputRef={(el) => {
						inputs.current[0] = el;
					}}
					onFocus={() => setCursor(-1)}
				>
					Tout
				</GameCheck>
				<div
					role="group"
					aria-label={family.label}
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
						gridAutoFlow: "row",
						columnGap: 32,
						rowGap: 14,
						paddingLeft: 0,
					}}
				>
					{grid.map(({ option, i, row, col }) => (
						<div key={option.value} style={{ gridRow: row + 1, gridColumn: col + 1 }}>
							<GameCheck
								checked={isChecked(draft, family, option.value)}
								onChange={(checked) => setDraft((d) => toggle(d, family, option.value, checked))}
								icon={option.icon}
								cursor={cursor === i}
								tabIndex={cursor === i ? 0 : -1}
								inputRef={(el) => {
									inputs.current[i + 1] = el;
								}}
								onFocus={() => setCursor(i)}
							>
								<div style={{ display: "inline-flex", flexDirection: "column", verticalAlign: "middle" }}>
									<span className="game-check__title">{option.label}</span>
									{option.description ? (
										<span className="game-check__desc" style={{ fontSize: "0.8em", opacity: 0.75, fontWeight: 400 }}>
											{option.description}
										</span>
									) : null}
								</div>
								{option.count !== undefined ? (
									<span className="game-check__count">
										{option.count.toLocaleString("fr")}
									</span>
								) : null}
							</GameCheck>
						</div>
					))}
				</div>
				{family.extra ? <div className="game-filter-panel__extra">{family.extra}</div> : null}
				<div style={{ display: "flex", justifyContent: "flex-end" }}>
					<GameKeyHint keyLabel="V" onActivate={toggleAll} className="game-button-secondary">
						Tout
					</GameKeyHint>
				</div>
			</div>
		</GamePanel>
	);
}

/** Résume l'état appliqué en libellés — pour la barre qui ouvre le panneau. */
export function describeFilters(families: readonly GameFilterFamily[], value: GameFilterValue): string[] {
	const parts: string[] = [];
	for (const family of families) {
		const selected = value[family.id] ?? [];
		if (selected.length === 0) continue;
		const labels = selected.map((v) => {
			const option = family.options.find((o) => o.value === v);
			return typeof option?.label === "string" ? option.label : v;
		});
		parts.push(`${family.label} : ${labels.join(", ")}`);
	}
	return parts;
}
