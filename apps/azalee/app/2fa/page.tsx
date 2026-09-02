"use client";

/**
 * `/2fa` — la page vers laquelle `auth-client.ts` redirigeait déjà, en 404.
 *
 * Elle vit HORS du groupe `(auth)` volontairement : ce groupe renvoie vers
 * `/dashboard` dès qu'une session existe, et la vérification du second facteur
 * se joue justement autour de la naissance de cette session. La garde du groupe
 * transformerait la page en boucle de redirection au pire moment.
 */
import { Skeleton, TwoFactorChallenge } from "@rosegriffon/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { authClient } from "@/lib/auth-client";

export const dynamic = "force-dynamic";

function Verification() {
	const router = useRouter();
	const parametres = useSearchParams();
	// `callbackURL` est repris tel quel de la connexion, mais seulement s'il
	// reste interne : une redirection ouverte sur une page d'authentification
	// est exactement ce qu'on utilise pour faire atterrir quelqu'un sur un faux
	// site juste après qu'il a prouvé son identité.
	const demande = parametres.get("callbackURL");
	const destination = demande && demande.startsWith("/") && !demande.startsWith("//")
		? demande
		: "/";

	return (
		<main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
			<TwoFactorChallenge
				hrefAide="/contact"
				onSucces={() => {
					router.push(destination);
					router.refresh();
				}}
				verifierCode={async (code, appareilDeConfiance) => {
					const { error } = await authClient.twoFactor.verifyTotp({
						code,
						trustDevice: appareilDeConfiance,
					});
					if (error) {
						throw new Error(error.message ?? "Code refusé.");
					}
				}}
				verifierCodeDeSecours={async (code) => {
					const { error } = await authClient.twoFactor.verifyBackupCode({ code });
					if (error) {
						throw new Error(error.message ?? "Code de secours refusé.");
					}
				}}
			/>
		</main>
	);
}

export default function Page() {
	// `useSearchParams` impose une frontière `Suspense`, donc le HTML servi est
	// vide et tout arrive côté client. Un `fallback` à `null` laissait une page
	// entièrement blanche le temps de l'hydratation — sur l'écran qui décide si
	// l'on entre ou non dans son compte, c'est l'endroit où l'on croit le moins
	// à une panne passagère.
	return (
		<Suspense
			fallback={
				<main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
					<div className="w-full max-w-md space-y-4 rounded-xl border border-border p-6">
						<Skeleton className="h-6 w-64" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full rounded-full" />
					</div>
				</main>
			}
		>
			<Verification />
		</Suspense>
	);
}
