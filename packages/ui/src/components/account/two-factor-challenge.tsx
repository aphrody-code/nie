"use client";

/**
 * L'écran qui manquait — celui où l'on saisit son code après la connexion.
 *
 * ── POURQUOI IL EST INDISPENSABLE ──────────────────────────────────────────
 * `auth-client.ts` redirige vers `/2fa` dès qu'une connexion demande un second
 * facteur (`onTwoFactorRedirect`). Cette page n'existait dans aucune des deux
 * applications : elle répondait 404. Autrement dit, le jour où quelqu'un aurait
 * armé sa double authentification, il aurait été mis dehors de son propre
 * compte — mot de passe accepté, second facteur jamais demandé, aucune porte de
 * sortie. Un placeholder qui verrouille est pire qu'une fonction absente.
 *
 * ── LE CODE DE SECOURS EST À ÉGALITÉ, PAS EN PETIT ─────────────────────────
 * On arrive ici précisément quand le téléphone n'est pas là. Reléguer les codes
 * de secours dans un lien discret, c'est faire perdre le compte à celui qui a
 * fait exactement ce qu'on lui a demandé : les noter.
 */
import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "../button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import { Input } from "../input";
import { Label } from "../label";

interface TwoFactorChallengeProps {
	/** `authClient.twoFactor.verifyTotp` — code à six chiffres de l'application. */
	verifierCode: (code: string, appareilDeConfiance: boolean) => Promise<void>;
	/** `authClient.twoFactor.verifyBackupCode` — un des dix codes notés. */
	verifierCodeDeSecours: (code: string) => Promise<void>;
	/** Où aller une fois le second facteur accepté. */
	onSucces: () => void;
	/** Lien de sortie quand on n'a plus ni téléphone ni code. */
	hrefAide?: string;
}

export function TwoFactorChallenge({
	verifierCode,
	verifierCodeDeSecours,
	onSucces,
	hrefAide = "/contact",
}: TwoFactorChallengeProps) {
	const [secours, setSecours] = useState(false);
	const [code, setCode] = useState("");
	const [confiance, setConfiance] = useState(false);
	const [enCours, setEnCours] = useState(false);

	const envoyer = async (evenement: React.FormEvent) => {
		evenement.preventDefault();
		const saisi = code.trim();
		if (saisi.length === 0) {
			return;
		}
		setEnCours(true);
		try {
			if (secours) {
				await verifierCodeDeSecours(saisi);
			} else {
				await verifierCode(saisi, confiance);
			}
			onSucces();
		} catch (erreur) {
			toast.error(
				erreur instanceof Error && erreur.message
					? erreur.message
					: "Code refusé. Vérifie l'heure de ton téléphone, ou utilise un code de secours."
			);
			setCode("");
		} finally {
			setEnCours(false);
		}
	};

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<ShieldCheck className="size-5 shrink-0 text-succes" aria-hidden />
					Vérification en deux étapes
				</CardTitle>
				<CardDescription>
					{secours
						? "Saisis un de tes codes de secours. Chacun ne sert qu'une fois."
						: "Saisis le code affiché par ton application d'authentification."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form className="space-y-4" onSubmit={envoyer}>
					<div className="space-y-1.5">
						<Label htmlFor="code-2fa">{secours ? "Code de secours" : "Code à six chiffres"}</Label>
						<Input
							id="code-2fa"
							autoFocus
							autoComplete="one-time-code"
							inputMode={secours ? "text" : "numeric"}
							maxLength={secours ? 32 : 6}
							placeholder={secours ? "xxxxx-xxxxx" : "123456"}
							value={code}
							onChange={(evenement) => setCode(evenement.target.value)}
						/>
					</div>

					{!secours && (
						<label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
							<input
								type="checkbox"
								className="mt-0.5 size-4 accent-primary"
								checked={confiance}
								onChange={(evenement) => setConfiance(evenement.target.checked)}
							/>
							Faire confiance à cet appareil (aucun code ne sera demandé pendant 60 jours).
						</label>
					)}

					<Button type="submit" className="w-full" disabled={enCours || code.trim().length === 0}>
						{enCours && <Loader2 className="size-4 animate-spin" aria-hidden />}
						Vérifier
					</Button>

					<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="px-1"
							onClick={() => {
								setSecours((valeur) => !valeur);
								setCode("");
							}}
						>
							<KeyRound className="size-3.5" aria-hidden />
							{secours ? "Utiliser mon application" : "Utiliser un code de secours"}
						</Button>
						<a href={hrefAide} className="text-muted-foreground underline underline-offset-2">
							Je n&apos;ai plus ni l&apos;un ni l&apos;autre
						</a>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
