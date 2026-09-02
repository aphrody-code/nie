"use client";

/**
 * Popup de choix de bannière — les illustrations du jeu, servies par le CDN.
 *
 * ── CE QU'ELLE REMPLACE ────────────────────────────────────────────────────
 * Trois vignettes en dur, dont deux images générées par IA (`griffon_banner_one`,
 * `lightning_banner_two`) : un griffon dans un cadre dans un cadre, un stade au
 * texte illisible, aucune des deux ne montrant le jeu. Le CDN décode en direct
 * les VRAIES illustrations d'Inazuma Eleven: Victory Road ; il n'y avait aucune
 * raison de proposer autre chose, et deux profils portaient déjà une de ces
 * images.
 *
 * ── ELLE NE PARLE QU'À SA PROPRE ORIGINE ───────────────────────────────────
 * L'API du wiki (`api.rosegriffon.fr/azalee`) est ouverte en CORS, mais
 * l'appeler depuis le navigateur ajouterait un préflight par frappe et
 * dépendrait de la politique de sécurité de contenu de chaque app. Chaque app
 * relaie donc la galerie sur `/api/galerie` (côté serveur, en local) et la
 * popup ne connaît que ce chemin.
 *
 * ── LA VIGNETTE EST UNE VIGNETTE ───────────────────────────────────────────
 * La grille charge la variante `?w=400&format=webp` (≈ 8 à 60 Ko) ; l'original
 * PNG pèse jusqu'à 12 Mo. C'est ce qui rend une grille de douze images
 * supportable sur téléphone. Ce qu'on ENREGISTRE est la variante large
 * (`?w=1600`), pas l'original non plus.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, ImageIcon, Loader2, Search } from "lucide-react";

import {
	CATEGORIES_GALERIE,
	GALERIE_PAR_PAGE,
	lireReponseGalerie,
	ROUTE_GALERIE,
	urlPageGalerie,
	type IllustrationGalerie,
} from "../../lib/galerie-cdn";
import { cn } from "../../lib/utils";
import { Button } from "../button";
import { Input } from "../input";
import { ResponsiveDialog } from "../responsive-dialog";

interface BannerPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Bannière actuellement posée, pour la marquer dans la grille. */
	valeur?: string | null;
	/** Reçoit l'URL large de l'illustration choisie. */
	onChoisir: (url: string) => void;
	/** Chemin de relais, si l'app ne sert pas la galerie sur `/api/galerie`. */
	endpoint?: string;
}

export function BannerPicker({
	open,
	onOpenChange,
	valeur,
	onChoisir,
	endpoint = ROUTE_GALERIE,
}: BannerPickerProps) {
	const [illustrations, setIllustrations] = useState<IllustrationGalerie[]>([]);
	const [categorie, setCategorie] = useState("");
	const [recherche, setRecherche] = useState("");
	const [saisie, setSaisie] = useState("");
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [chargement, setChargement] = useState(false);
	const [erreur, setErreur] = useState<string | null>(null);

	const charger = useCallback(async () => {
		setChargement(true);
		setErreur(null);
		try {
			const reponse = await fetch(
				urlPageGalerie(endpoint, { categorie, page, parPage: GALERIE_PAR_PAGE, recherche })
			);
			if (!reponse.ok) {
				throw new Error(`La galerie a répondu ${reponse.status}.`);
			}
			const lue = lireReponseGalerie(await reponse.json());
			setIllustrations(lue.illustrations);
			setTotal(lue.total);
		} catch (err) {
			setErreur(err instanceof Error ? err.message : "Galerie injoignable.");
			setIllustrations([]);
			setTotal(0);
		} finally {
			setChargement(false);
		}
	}, [categorie, endpoint, page, recherche]);

	// Rien n'est demandé tant que la popup est fermée : sur le formulaire de
	// compte, la plupart des visites ne l'ouvrent jamais.
	useEffect(() => {
		if (open) {
			void charger();
		}
	}, [charger, open]);

	const pages = Math.max(1, Math.ceil(total / GALERIE_PAR_PAGE));

	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Choisir une illustration"
			description="Les illustrations du jeu, servies par le CDN Rose Griffon."
			contentClassName="sm:max-w-3xl"
			footer={
				<div className="flex w-full flex-wrap items-center justify-between gap-2">
					<span className="text-xs text-muted-foreground">
						{total > 0 ? `${total.toLocaleString("fr-FR")} illustrations` : "—"}
					</span>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={page <= 1 || chargement}
							onClick={() => setPage((p) => Math.max(1, p - 1))}
						>
							Précédent
						</Button>
						<span className="text-xs text-muted-foreground">
							{page} / {pages}
						</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={page >= pages || chargement}
							onClick={() => setPage((p) => p + 1)}
						>
							Suivant
						</Button>
					</div>
				</div>
			}
		>
			<div className="space-y-4">
				<form
					className="flex gap-2"
					onSubmit={(evenement) => {
						evenement.preventDefault();
						setPage(1);
						setRecherche(saisie);
					}}
				>
					<Input
						value={saisie}
						onChange={(evenement) => setSaisie(evenement.target.value)}
						placeholder="Chercher (nom du fichier : stadium, chronicle…)"
						aria-label="Chercher une illustration"
					/>
					<Button type="submit" variant="secondary" size="icon" aria-label="Chercher">
						<Search className="size-4" aria-hidden />
					</Button>
				</form>

				<div className="flex flex-wrap gap-1.5">
					{CATEGORIES_GALERIE.map((entree) => (
						<Button
							key={entree.valeur || "toutes"}
							type="button"
							size="sm"
							variant={categorie === entree.valeur ? "default" : "outline"}
							className="h-7 rounded-full px-3 text-xs"
							aria-pressed={categorie === entree.valeur}
							onClick={() => {
								setPage(1);
								setCategorie(entree.valeur);
							}}
						>
							{entree.libelle}
						</Button>
					))}
				</div>

				{erreur && (
					<p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
						{erreur} Réessaie dans un instant, ou colle l&apos;URL de ton choix.
					</p>
				)}

				<div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
					{chargement && illustrations.length === 0
						? Array.from({ length: GALERIE_PAR_PAGE }, (_, index) => (
								<div
									key={index}
									className="aspect-video animate-pulse rounded-lg border border-border bg-muted"
								/>
							))
						: illustrations.map((illustration) => {
								const choisie = valeur === illustration.pleine;
								return (
									<button
										key={illustration.id}
										type="button"
										aria-pressed={choisie}
										title={illustration.titre}
										onClick={() => {
											onChoisir(illustration.pleine);
											onOpenChange(false);
										}}
										className={cn(
											"group relative aspect-video overflow-hidden rounded-lg border-2 transition-colors",
											choisie
												? "border-primary ring-2 ring-ring/30"
												: "border-border hover:border-muted-foreground/50"
										)}
									>
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img
											src={illustration.vignette}
											alt={illustration.titre}
											loading="lazy"
											className="absolute inset-0 size-full object-cover"
										/>
										<span className="absolute inset-x-0 bottom-0 truncate bg-foreground/50 px-1.5 py-1 text-[10px] font-bold text-background">
											{illustration.titre}
										</span>
										{choisie && (
											<span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
												<Check className="size-3" strokeWidth={3} aria-hidden />
											</span>
										)}
									</button>
								);
							})}
				</div>

				{!chargement && illustrations.length === 0 && !erreur && (
					<p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
						<ImageIcon className="size-4" aria-hidden />
						Aucune illustration pour ce filtre.
					</p>
				)}

				{chargement && illustrations.length > 0 && (
					<p className="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 className="size-3 animate-spin" aria-hidden />
						Chargement…
					</p>
				)}
			</div>
		</ResponsiveDialog>
	);
}
