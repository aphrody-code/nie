/**
 * L'accueil : le jeu, dans le navigateur.
 *
 * Un canevas, une boucle d'animation, et le clavier. Rien d'autre — pas de menu React
 * par-dessus, pas de barre, pas d'encart d'état : ce qui s'affiche est ce que le moteur rend.
 *
 * ## Le jeu ne dépend pas de l'index du VFS
 *
 * L'accueil attendait que `/api/v1/health` déclare son VFS `pret` avant d'afficher quoi que ce
 * soit : c'était juste, tant que l'accueil était un menu de catalogues qui n'aurait mené nulle
 * part. Le jeu, lui, embarque ce dont il a besoin — sa logique dans le wasm, sa police dans
 * `/static/jeu/`. Le faire attendre un index qu'il n'interroge pas ajouterait une seconde
 * d'écran vide pour rien.
 *
 * ## L'échelle est entière, et le rendu n'est pas lissé
 *
 * Le framebuffer fait 1280×720 pixels du jeu. Un facteur fractionnaire (1,37×) interpole des
 * pixels qui n'existent pas et rend un texte flou ; l'entier le plus grand qui tienne dans la
 * fenêtre garde chaque pixel carré. `image-rendering: pixelated` fait le reste : sans lui, le
 * navigateur lisse l'agrandissement et annule la mesure.
 *
 * ## Ce que cette page ne prétend pas
 *
 * Le moteur porté rend un **placeholder 2D** — voir `jeu/pont.ts` et
 * `crates/engine/nie-wasm/src/lib.rs`. Aucune fidélité au rendu du jeu n'est affirmée ici, et
 * aucun texte de cette page n'en promet.
 */
import { useEffect, useRef, useState } from "react";
import { chargerJeu, commandePourTouche, type PoigneeJeu } from "../jeu/pont";

/** Le pas de temps maximal d'une image, en secondes. */
const DT_MAX = 1 / 20;

/** L'état du chargement : ni un booléen, ni une chaîne libre. */
type Etat = "chargement" | "pret" | "panne";

export function Jeu() {
	const canevas = useRef<HTMLCanvasElement | null>(null);
	const [etat, setEtat] = useState<Etat>("chargement");
	const [score, setScore] = useState<[number, number] | null>(null);

	useEffect(() => {
		let poignee: PoigneeJeu | null = null;
		let image: number | undefined;
		let vivant = true;

		const surTouche = (e: KeyboardEvent) => {
			const cmd = commandePourTouche(e.key);
			if (cmd === null || poignee === null) return;
			// Les flèches font défiler la page et `Tab` sort du canevas : une touche que le jeu
			// consomme ne doit pas AUSSI agir sur le document.
			e.preventDefault();
			poignee.entree(cmd);
		};

		void (async () => {
			try {
				const p = await chargerJeu();
				if (!vivant) return;
				poignee = p;
				const el = canevas.current;
				const ctx = el?.getContext("2d") ?? null;
				if (el === null || ctx === null) {
					setEtat("panne");
					return;
				}
				el.width = p.largeur;
				el.height = p.hauteur;
				setEtat("pret");
				window.addEventListener("keydown", surTouche);

				let precedent = performance.now();
				const boucle = (maintenant: number) => {
					// Borné : un onglet remis au premier plan après une minute rendrait sinon
					// soixante secondes de physique en une image.
					const dt = Math.min((maintenant - precedent) / 1000, DT_MAX);
					precedent = maintenant;
					p.avancer(dt);
					ctx.putImageData(p.image(), 0, 0);
					setScore(p.enMatch() ? p.score() : null);
					image = requestAnimationFrame(boucle);
				};
				image = requestAnimationFrame(boucle);
			} catch {
				// Le détail ne dit rien à qui ouvre la page, et le seul geste utile — recharger —
				// n'en dépend pas.
				if (vivant) setEtat("panne");
			}
		})();

		return () => {
			vivant = false;
			if (image !== undefined) cancelAnimationFrame(image);
			window.removeEventListener("keydown", surTouche);
		};
	}, []);

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				display: "grid",
				placeItems: "center",
				background: "#000",
				overflow: "hidden",
			}}
		>
			<canvas
				ref={canevas}
				// Le canevas garde ses proportions et remplit la fenêtre sans la dépasser. `100%`
				// sur les deux axes avec `object-fit` ne s'applique pas à un canevas : ce sont les
				// deux maximums qui bornent, et le rapport d'aspect qui décide lequel mord.
				style={{
					maxWidth: "100%",
					maxHeight: "100%",
					aspectRatio: "16 / 9",
					width: "100%",
					imageRendering: "pixelated",
					visibility: etat === "pret" ? "visible" : "hidden",
				}}
			/>
			{etat === "chargement" ? <Message>Chargement…</Message> : null}
			{etat === "panne" ? <Message>Le jeu n'a pas pu démarrer. Rechargez la page.</Message> : null}
			{score === null ? null : (
				<p
					aria-live="polite"
					style={{
						position: "absolute",
						top: "1rem",
						color: "#fff",
						font: "600 1.25rem/1 system-ui, sans-serif",
						margin: 0,
					}}
				>
					{score[0]} — {score[1]}
				</p>
			)}
		</div>
	);
}

/** Le seul texte que cette page affiche hors du jeu lui-même. */
function Message({ children }: { children: React.ReactNode }) {
	return (
		<p
			style={{
				position: "absolute",
				color: "#fff",
				font: "400 1rem/1.5 system-ui, sans-serif",
				margin: 0,
			}}
		>
			{children}
		</p>
	);
}
