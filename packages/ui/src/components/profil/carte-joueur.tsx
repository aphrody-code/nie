"use client";

/**
 * Carte de joueur — l'en-tête du profil public, dans la forme du jeu.
 *
 * ── CE QU'ELLE REPREND, ET POURQUOI ────────────────────────────────────────
 * Inazuma Eleven présente ses joueurs sur une plaque en biais : un ruban de
 * titre posé en haut, le portrait à gauche, le nom en grand par-dessus un fond
 * à chevrons, une plaque claire pour le surnom, la ligne d'élément et de poste
 * en bas, le niveau à droite. Le profil du site affichait les mêmes
 * informations empilées à la verticale, sans rien qui rappelle le jeu dont il
 * parle. La carte reprend la composition ; les données, elles, sont les nôtres
 * et sont vraies — le niveau vient de l'XP réellement gagnée sur le Discord,
 * pas d'une décoration.
 *
 * ── LE BIAIS EST UN `clip-path`, PAS UNE IMAGE ─────────────────────────────
 * Les coins coupés du jeu sont reproduits en `clip-path` : la carte reste
 * fluide, s'imprime, se met à l'échelle et suit le thème. Une image de cadre
 * aurait imposé un ratio fixe et un aplat de couleur — donc un fond qui ne peut
 * pas être la bannière choisie par le membre.
 *
 * ── DÉGRADATION ────────────────────────────────────────────────────────────
 * Sans bannière, le fond est le dégradé de la charte ; sans niveau (compte non
 * lié au Discord), le bloc de droite disparaît au lieu d'afficher « Niv. 0 » ;
 * sans titre, le ruban n'est pas rendu. La carte ne montre jamais un
 * emplacement vide.
 */
import { useMemo } from "react";

import { AVAILABLE_BADGES } from "../../lib/badges-profil";
import { urlBanniereAffichable } from "../../lib/galerie-cdn";
import { cn } from "../../lib/utils";

export interface CarteJoueurProps {
	/** Pseudo — la plaque claire sous le nom. */
	pseudo: string;
	/** Nom affiché en grand. Le pseudo prend sa place quand il est absent. */
	nom?: string | null;
	/** Titre honorifique, dans le ruban du haut (`bot_profils.titre`). */
	titre?: string | null;
	/** Description courte, sous le nom. */
	description?: string | null;
	avatarUrl?: string | null;
	/** Illustration de fond, déjà recadrée de ses bandes noires par le CDN. */
	banniereUrl?: string | null;
	/** Cadrage vertical de cette illustration, de 0 (haut) à 100 (bas). */
	banniereCadrage?: number | null;
	/** Identifiants d'éléments portés par le membre. */
	badges?: readonly string[] | null;
	/** Poste, abrégé comme sur une fiche du jeu (`GAR`, `DEF`, `MIL`, `ATT`). */
	poste?: string | null;
	/**
	 * Place au classement du serveur.
	 *
	 * C'est notre équivalent du « Grade » de la fiche du jeu : un chiffre gagné,
	 * pas un rang décoratif. Absent quand le membre n'est pas classé.
	 */
	classement?: { place: number; total: number } | null;
	/**
	 * Rôle DISCORD du membre — celui du serveur, pas celui du site.
	 *
	 * `profiles.role` dit un droit d'accès au site (« member », « admin ») : ça
	 * n'intéresse personne sur un profil public, et ça ne correspond à rien de ce
	 * que les membres voient d'eux-mêmes. Le rôle qui les identifie est celui
	 * qu'ils portent sur le Discord — « Joueur Route Victoire », « Modérateurs » —
	 * avec sa couleur, celle-là même qui colore leur pseudo dans le salon.
	 */
	role?: { nom: string; couleur: number | null } | null;
	/** Niveau de communauté et progression, quand le compte est lié au Discord. */
	niveau?: { valeur: number; restant: number; rang: string } | null;
	/** Actions posées en bas de carte (éditer, partager…). */
	actions?: React.ReactNode;
}

/**
 * Les quatre postes, avec les couleurs du jeu.
 *
 * Les valeurs passent par les tokens `poste-*` de `styles.css` : elles étaient
 * écrites en hexadécimal au milieu d'un composant du wiki, sous le commentaire
 * « matching game exactly ». Une couleur juste mais recopiée finit toujours par
 * diverger.
 */
const POSTES: Record<string, { abrege: string; nom: string; couleur: string }> = {
	ATT: { abrege: "FW", couleur: "var(--color-poste-attaquant)", nom: "Attaquant" },
	DEF: { abrege: "DF", couleur: "var(--color-poste-defenseur)", nom: "Défenseur" },
	GAR: { abrege: "GK", couleur: "var(--color-poste-gardien)", nom: "Gardien" },
	MIL: { abrege: "MF", couleur: "var(--color-poste-milieu)", nom: "Milieu" },
};

export function CarteJoueur({
	pseudo,
	nom,
	titre,
	description,
	avatarUrl,
	banniereUrl,
	banniereCadrage,
	badges,
	poste,
	classement,
	role,
	niveau,
	actions,
}: CarteJoueurProps) {
	const elements = useMemo(() => {
		const connus = new Map(AVAILABLE_BADGES.map((badge) => [badge.id, badge]));
		return (badges ?? [])
			.map((id) => connus.get(id))
			.filter((badge): badge is (typeof AVAILABLE_BADGES)[number] => badge !== undefined);
	}, [badges]);

	const nomAffiche = nom?.trim() || pseudo;
	const posteAffiche = poste ? POSTES[poste] : null;
	// Une bannière choisie avant l'arrivée du recadrage garde ses bandes noires
	// en base : on les retire à l'affichage plutôt que de réécrire les lignes.
	const fond = urlBanniereAffichable(banniereUrl);
	const cadrage = Math.min(100, Math.max(0, banniereCadrage ?? 50));

	return (
		<section aria-label={`Carte de ${nomAffiche}`} className="relative isolate w-full">
			{/* Le ruban de titre chevauche la carte : il est donc posé AVANT, dans sa
			    propre pile, et la carte le recouvre par le bas. */}
			{titre && (
				<div className="relative z-20 mx-auto -mb-px w-fit max-w-[85%] px-4">
					<p className="truncate rounded-t-xl border border-b-0 border-outline-variant bg-surface-container-high px-6 py-1.5 text-center text-sm font-bold text-on-surface">
						{titre}
					</p>
				</div>
			)}

			<div
				className="relative overflow-hidden border border-outline-variant/60 bg-rg-brique shadow-[0_4px_0_0_rgba(0,0,0,0.5)]"
				// Coins coupés en biais, comme la plaque du jeu. En pourcentage : la
				// coupe garde le même angle apparent quelle que soit la largeur.
				style={{ clipPath: "polygon(2.5% 0, 100% 0, 97.5% 100%, 0 100%)" }}
			>
				{fond ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={fond}
						alt=""
						aria-hidden
						className="absolute inset-0 -z-10 size-full object-cover"
						// Le cadrage choisi par le membre : `object-cover` seul prend
						// toujours le centre de l'image.
						style={{ objectPosition: `50% ${cadrage}%` }}
					/>
				) : (
					<div
						aria-hidden
						className="absolute inset-0 -z-10 bg-linear-to-r from-rg-brique via-rg-brique-clair to-rg-brique"
					/>
				)}

				{/* Deux voiles : le motif en biais du jeu, puis un dégradé sombre qui
				    garantit la lisibilité du texte quelle que soit l'illustration. */}
				<div
					aria-hidden
					className="absolute inset-0 -z-10 opacity-25 mix-blend-overlay"
					style={{
						backgroundImage:
							"repeating-linear-gradient(135deg, rgb(255 255 255 / 0.55) 0 10px, transparent 10px 22px)",
					}}
				/>
				<div
					aria-hidden
					className="absolute inset-0 -z-10 bg-linear-to-r from-black/70 via-black/45 to-black/60"
				/>

				<div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:gap-6 sm:px-10 sm:py-6">
					{/* Une `<img>` et pas le composant `Avatar` de Radix : celui-ci ne
					    monte son image qu'APRÈS hydratation (le HTML servi ne contient
					    que les initiales), si bien que la photo restait absente du rendu
					    serveur — et donc de tout aperçu de lien partagé. Ici l'image est
					    dans le document dès la première réponse. */}
					{avatarUrl ? (
						// eslint-disable-next-line @next/next/no-img-element
						<img
							src={avatarUrl}
							alt={`Photo de profil de ${pseudo}`}
							className="size-20 shrink-0 rounded-full border-2 border-white/80 object-cover shadow-lg sm:size-28"
						/>
					) : (
						<span
							aria-hidden
							className="flex size-20 shrink-0 items-center justify-center rounded-full border-2 border-white/80 bg-rg-marine text-lg font-bold text-white shadow-lg sm:size-28"
						>
							{pseudo.slice(0, 2).toUpperCase()}
						</span>
					)}

					<div className="min-w-0 flex-1 space-y-2">
						<h1
							className="truncate text-2xl leading-tight font-extrabold text-white sm:text-4xl"
							// Contour sombre : le nom est détouré dans le jeu, et c'est ce qui
							// le fait tenir sur une bannière claire comme sur une sombre.
							style={{ textShadow: "0 2px 0 rgba(0,0,0,0.75), 0 0 12px rgba(0,0,0,0.45)" }}
						>
							{nomAffiche}
						</h1>

						<div className="flex flex-wrap items-center gap-2">
							<span className="max-w-full truncate rounded-md bg-white/90 px-3 py-0.5 text-sm font-bold text-rg-marine">
								@{pseudo}
							</span>
							{role && (
								<span
									className="rounded-md border px-2 py-0.5 text-xs font-bold tracking-wide uppercase"
									// Couleur du rôle telle que Discord la donne (entier RVB).
									// `0` signifie « pas de couleur » chez Discord : on retombe
									// alors sur le blanc du reste de la carte.
									style={
										role.couleur
											? {
													borderColor: `#${role.couleur.toString(16).padStart(6, "0")}`,
													color: `#${role.couleur.toString(16).padStart(6, "0")}`,
												}
											: { borderColor: "rgb(255 255 255 / 0.4)", color: "rgb(255 255 255 / 0.9)" }
									}
								>
									{role.nom}
								</span>
							)}
						</div>

						{description && (
							<p className="line-clamp-2 max-w-2xl text-sm leading-snug text-white/90">
								{description}
							</p>
						)}

						{(elements.length > 0 || posteAffiche || classement) && (
							<ul className="flex flex-wrap items-center gap-1.5 pt-0.5">
								{posteAffiche && (
									<li
										title={posteAffiche.nom}
										className="rounded-md px-2 py-0.5 text-[11px] font-extrabold tracking-wider text-white uppercase"
										style={{ backgroundColor: posteAffiche.couleur }}
									>
										{posteAffiche.abrege}
									</li>
								)}
								{classement && (
									<li className="rounded-md border border-white/40 bg-black/35 px-2 py-0.5 text-[11px] font-bold text-white uppercase">
										{classement.place}ᵉ / {classement.total.toLocaleString("fr-FR")}
									</li>
								)}
								{elements.map((element) => {
									return (
										<li
											key={element.id}
											title={element.description}
											className={cn(
												"flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase",
												"border-white/40 bg-black/35 text-white"
											)}
										>
											{/* Icône officielle du jeu (`/spirit_type/*.webp`).
											    eslint-disable-next-line @next/next/no-img-element */}
											<img src={element.iconeUrl} alt="" aria-hidden className="size-4" />
											{element.label}
										</li>
									);
								})}
							</ul>
						)}
					</div>

					{/* Bloc de niveau : la colonne de droite de la carte du jeu. */}
					{niveau && (
						<div className="shrink-0 border-white/30 text-white sm:border-l sm:pl-6">
							<div className="flex items-end gap-2 sm:flex-col sm:items-end sm:gap-0">
								<span className="text-xs font-semibold text-white/80 uppercase">Niv.</span>
								<span
									className="text-3xl leading-none font-extrabold sm:text-5xl"
									style={{ textShadow: "0 2px 0 rgba(0,0,0,0.6)" }}
								>
									{niveau.valeur}
								</span>
							</div>
							<p className="mt-1 text-right text-[11px] font-semibold text-white/80 uppercase">
								{niveau.restant > 0
									? `Suivant ${niveau.restant.toLocaleString("fr-FR")}`
									: "Palier maximum"}
							</p>
							<p className="mt-1 rounded-md bg-rg-or/90 px-2 py-0.5 text-center text-[11px] font-extrabold tracking-wide text-rg-marine uppercase">
								{niveau.rang}
							</p>
						</div>
					)}
				</div>

				{actions && <div className="px-5 pb-4 sm:px-10">{actions}</div>}
			</div>
		</section>
	);
}
