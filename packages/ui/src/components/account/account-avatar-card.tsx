"use client";

import { Camera, ExternalLink, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { libelleRole } from "@rosegriffon/types/roles";

import { cn } from "../../lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "../avatar";
import { Badge } from "../badge";
import { Button } from "../button";
import { Card, CardContent } from "../card";

interface AccountAvatarCardProps {
	avatarUrl?: string | null;
	username?: string | null;
	/** Rôle affiché sous le pseudo — traduit ici, jamais la valeur brute. */
	role?: string | null;
	/**
	 * Adresse du profil public.
	 *
	 * Il n'y avait qu'un lien « Retour à mon profil » en haut de page, en gris,
	 * au-dessus du titre : à cet endroit il se lit comme un fil d'Ariane, pas
	 * comme une action. Or la question qu'on se pose en modifiant son profil est
	 * toujours la même — « ça donne quoi ? » —, et la réponse doit être à côté de
	 * l'avatar, pas dans la barre de navigation.
	 *
	 * Absent, aucun bouton n'est rendu : un compte sans pseudo n'a pas encore de
	 * page publique.
	 */
	profileHref?: string | null;
	/**
	 * Téléverse le fichier et renvoie l'URL publique définitive.
	 *
	 * Elle DOIT être unique par téléversement (nom de fichier horodaté ou
	 * aléatoire) : réutiliser un chemin fixe renvoie la même URL, que le
	 * navigateur et le CDN servent depuis leur cache — l'ancienne image reste
	 * alors affichée alors que le stockage a bien été mis à jour.
	 */
	onUpload: (file: File) => Promise<string>;
}

/**
 * Ce que le stockage accepte réellement, pas ce qu'on aimerait.
 *
 * Le bucket `avatars` est plafonné à 2 Mo et n'accepte que PNG, JPEG et WebP
 * (vérifié dans `storage.buckets` le 1/9/2026). L'interface annonçait « 4 Mo
 * maximum » et proposait les GIF dans le sélecteur : le fichier partait, la
 * barre tournait, et le refus arrivait du serveur sous forme de message brut.
 * Une limite qui ment fait échouer APRÈS l'attente — le pire moment pour
 * apprendre la règle.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/** Les types que le bucket accepte, dans la forme attendue par `accept`. */
const TYPES_ACCEPTES = "image/png,image/jpeg,image/webp";

export function AccountAvatarCard({
	avatarUrl,
	username,
	role,
	profileHref,
	onUpload,
}: AccountAvatarCardProps) {
	const inputId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(avatarUrl ?? null);

	const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		// Réinitialise tout de suite : sans ça, resélectionner le même fichier
		// après un échec ne déclenche pas de nouvel évènement `change`.
		event.target.value = "";
		if (!file) {
			return;
		}
		if (!TYPES_ACCEPTES.split(",").includes(file.type)) {
			// Le bucket refuse tout le reste, GIF compris : autant le dire avant de
			// téléverser plutôt que de relayer son erreur après coup.
			toast.error("Choisis une image PNG, JPEG ou WebP.");
			return;
		}
		if (file.size > MAX_BYTES) {
			toast.error("Image trop lourde (2 Mo maximum).");
			return;
		}

		setUploading(true);
		try {
			const url = await onUpload(file);
			setPreviewUrl(url);
			toast.success("Avatar mis à jour.");
		} catch (error) {
			console.error("[compte] échec du téléversement d'avatar", error);
			toast.error(error instanceof Error ? error.message : "Erreur lors de l'envoi de l'image.");
		} finally {
			setUploading(false);
		}
	};

	return (
		<Card>
			<CardContent className="flex flex-col items-center gap-6 p-6 sm:p-8">
				<div className="group relative">
					<Avatar className="size-28 border-4 border-border shadow-lg transition-colors group-hover:border-primary/50 sm:size-36">
						<AvatarImage src={previewUrl ?? undefined} alt="" className="object-cover" />
						<AvatarFallback className="select-none bg-primary/10 text-4xl font-bold text-primary uppercase">
							{username?.[0] ?? "?"}
						</AvatarFallback>
					</Avatar>

					{/* Voile de survol : purement décoratif, l'action passe par le bouton. */}
					<div
						className={cn(
							"pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-foreground/40 opacity-0 transition-opacity",
							!uploading && "group-hover:opacity-100"
						)}
						aria-hidden
					>
						<Camera className="size-9 text-background" strokeWidth={1.5} />
					</div>

					{uploading && (
						<div className="absolute inset-0 z-20 flex items-center justify-center rounded-full bg-foreground/60">
							<Loader2 className="size-9 animate-spin text-background" aria-hidden />
						</div>
					)}

					{/* Bouton réel : un <label> seul n'est pas focusable au clavier. */}
					<button
						type="button"
						onClick={() => inputRef.current?.click()}
						disabled={uploading}
						aria-controls={inputId}
						className="absolute right-0 bottom-0 z-30 flex size-11 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden active:scale-95 disabled:opacity-50"
					>
						<Upload className="size-5" aria-hidden />
						<span className="sr-only">Changer d'avatar</span>
					</button>

					<input
						ref={inputRef}
						id={inputId}
						type="file"
						className="sr-only"
						accept={TYPES_ACCEPTES}
						onChange={handleChange}
						disabled={uploading}
						tabIndex={-1}
					/>
				</div>

				<div className="w-full space-y-2 text-center">
					<p className="truncate text-lg font-bold text-foreground">{username || "Utilisateur"}</p>
					{role && (
						<Badge variant="secondary" className="rounded-full">
							{libelleRole(role)}
						</Badge>
					)}
					{profileHref && (
						<Button variant="outline" size="sm" asChild className="w-full rounded-full">
							<Link href={profileHref}>
								<ExternalLink className="size-4" aria-hidden />
								Voir mon profil public
							</Link>
						</Button>
					)}
					<p className="text-xs text-muted-foreground">
						PNG, JPEG ou WebP — 400 × 400 px recommandé, 2 Mo maximum.
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
