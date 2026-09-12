/**
 * Les pièces communes d'un écran du site — un titre, un message, deux formats.
 *
 * ## Pourquoi ce fichier existe
 *
 * Elles vivaient dans `SecondaryScreen.tsx`, aux côtés d'une SECONDE coquille : une barre de
 * tuiles qui doublait la navigation de l'espace de travail. La coquille a disparu dans la fusion
 * du 2026-09-12 — il n'y en a plus qu'une, `shell/UnifiedShell.tsx` — mais ces quatre pièces
 * n'avaient rien à voir avec elle : le catalogue, les modèles et la galerie les emploient pour
 * leur propre contenu.
 */
import type { ReactNode } from "react";

/**
 * Le titre d'un écran : le bandeau bleu biseauté du menu, à sa taille de section.
 *
 * `RibbonBand` n'est pas réutilisé tel quel : il occupe toute la hauteur de son parent et
 * centre son texte, ce qui convient à un bandeau posé dans un canevas, pas à un titre de page.
 */
export function ViewTitle({ children, detail }: { children: ReactNode; detail?: ReactNode }) {
	return (
		<h2
			style={{
				...bevelStyle(14),
				// Le bandeau s'ajuste à son texte, comme celui du jeu (438 px pour « Victory
				// Road »). Étiré sur toute la largeur, son biseau devient invisible et il ne
				// ressemble plus à rien d'autre qu'à une barre de couleur.
				width: "fit-content",
				minWidth: 280,
				maxWidth: "100%",
				display: "flex",
				alignItems: "center",
				gap: "var(--jeu-espace-m)",
				margin: "0 0 var(--jeu-espace-l)",
				padding: "8px 34px",
				background:
					"linear-gradient(180deg, var(--jeu-tuile-active-haut), var(--jeu-tuile-active-bas))",
				color: "var(--jeu-texte-vif)",
				fontSize: 21,
				fontWeight: 800,
				letterSpacing: "0.06em",
				textShadow: "0 1px 3px rgb(10 47 102 / 85%)",
				boxShadow: "var(--jeu-ombre-tuile)",
			}}
		>
			<span>{children}</span>
			{detail ? (
				<span style={{ fontSize: 14, fontWeight: 700, opacity: 0.9 }}>{detail}</span>
			) : null}
		</h2>
	);
}

/**
 * Un message de l'écran — attente, vide, panne.
 *
 * Il parle à qui consulte le site, pas à qui l'exploite : ni nom de service, ni code d'erreur,
 * ni terme d'implémentation. Un message technique en façade ne répare rien et n'apprend rien à
 * son lecteur.
 */
export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "alerte" }) {
	return (
		<p
			role={tone === "alerte" ? "alert" : undefined}
			style={{
				margin: 0,
				padding: "var(--jeu-espace-m) var(--jeu-espace-l)",
				background: "rgb(255 255 255 / 75%)",
				borderLeft: `4px solid ${
					tone === "alerte" ? "var(--jeu-accent-brique)" : "var(--jeu-accent-azur)"
				}`,
				color: "var(--jeu-nuit-profonde)",
				fontWeight: 700,
			}}
		>
			{children}
		</p>
	);
}

/**
 * Un compte suivi de son nom, accordé.
 *
 * « 1 entrées » sur l'explorateur d'un dossier à une seule ligne : la faute est petite, elle
 * est en tête de page, et c'est le genre de détail qui fait douter du reste. Zéro prend le
 * singulier, comme le veut l'usage français.
 */
/**
 * Formate une taille en octets, **jusqu'aux gigaoctets**.
 *
 * L'échelle s'arrêtait aux mégaoctets, dans trois copies de cette fonction : `bgm_chronicle.awb`
 * s'affichait « 1291.9 Mo », et le plus gros fichier du jeu — un `.usm` de 2 099 267 008 octets —
 * « 2002.0 Mo ». Ce n'est pas faux, c'est illisible : passé mille, l'unité a changé et le
 * lecteur doit diviser de tête. Une fonction, un endroit.
 */
export function readableSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} o`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ko`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

export function agree(count: number, singular: string, plural = `${singular}s`): string {
	return `${count.toLocaleString("fr")} ${count > 1 ? plural : singular}`;
}

/** Le biseau du menu, en `clip-path` : haut décalé vers la droite, comme les tuiles du jeu. */
function bevelStyle(tilt: number) {
	return {
		clipPath: `polygon(${tilt}px 0, 100% 0, calc(100% - ${tilt}px) 100%, 0 100%)`,
	} as const;
}
