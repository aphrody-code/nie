"use client";

/**
 * Double authentification — la carte, et ce qu'il y avait derrière.
 *
 * ── CE QU'ELLE REMPLACE ────────────────────────────────────────────────────
 * Un bouton grisé « Bientôt disponible ». Le plugin `twoFactor` de Better Auth
 * était pourtant déjà déclaré côté serveur ET côté client, et `auth-client.ts`
 * redirigeait vers `/2fa` après une connexion à second facteur. Autrement dit,
 * la promesse n'était pas seulement creuse : si quelqu'un avait réussi à armer
 * sa 2FA par un autre chemin, sa connexion suivante l'aurait envoyé sur une
 * page qui n'existait pas — compte inaccessible, sans champ où saisir le code.
 *
 * ── L'ORDRE DES ÉTAPES EST CE QUI PROTÈGE ──────────────────────────────────
 *   1. `enable()` rend l'URI TOTP et dix codes de secours, mais n'arme RIEN ;
 *   2. l'utilisateur scanne, puis tape un premier code ;
 *   3. `verifyTotp()` confirme — c'est seulement là que le second facteur
 *      devient obligatoire.
 * Sans l'étape 2, on verrouille un compte derrière un secret que personne n'a
 * enregistré. C'est la panne la plus coûteuse du domaine : elle ne se voit
 * qu'à la connexion suivante, quand il est trop tard.
 *
 * ── LES CODES DE SECOURS NE S'AFFICHENT QU'UNE FOIS ────────────────────────
 * Better Auth ne les rend jamais deux fois (ils sont chiffrés en base). La
 * carte l'écrit, propose de les copier, et exige une case cochée avant de
 * refermer : un téléphone se perd, et un compte sans code de secours se perd
 * avec lui.
 */
import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import qrcode from "qrcode-generator";

import { Button } from "../button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import { Checkbox } from "../checkbox";
import { Input } from "../input";
import { Label } from "../label";
import { ResponsiveDialog } from "../responsive-dialog";

/** Ce que l'app branche derrière la carte — un appel Better Auth chacun. */
export interface TwoFactorActions {
	/** `authClient.twoFactor.enable` — rend l'URI TOTP et les codes de secours. */
	demarrer: (motDePasse?: string) => Promise<{ totpURI: string; backupCodes: string[] }>;
	/** `authClient.twoFactor.verifyTotp` — arme réellement le second facteur. */
	confirmer: (code: string) => Promise<void>;
	/** `authClient.twoFactor.disable` — le désarme. */
	desactiver: (motDePasse?: string) => Promise<void>;
	/** `authClient.twoFactor.generateBackupCodes` — en refait dix. */
	regenererCodes: (motDePasse?: string) => Promise<string[]>;
}

interface TwoFactorCardProps {
	enabled: boolean;
	/**
	 * Le compte a-t-il un mot de passe ? Sur un compte purement OAuth (Discord,
	 * Google, Patreon), Better Auth n'en réclame aucun — et le demander quand
	 * même n'aurait aucune valeur : il n'y a rien à saisir.
	 */
	demandeMotDePasse?: boolean;
	actions: TwoFactorActions;
	/** Rafraîchit la page après un changement d'état. */
	onChangement?: () => void;
}

type Etape = "repos" | "codes" | "verification";

export function TwoFactorCard({
	enabled,
	demandeMotDePasse = false,
	actions,
	onChangement,
}: TwoFactorCardProps) {
	const [ouvert, setOuvert] = useState(false);
	const [etape, setEtape] = useState<Etape>("repos");
	const [motDePasse, setMotDePasse] = useState("");
	const [uri, setUri] = useState<string | null>(null);
	const [codes, setCodes] = useState<string[]>([]);
	const [codeSaisi, setCodeSaisi] = useState("");
	const [notes, setNotes] = useState(false);
	const [enCours, setEnCours] = useState(false);

	const fermer = () => {
		setOuvert(false);
		setEtape("repos");
		setMotDePasse("");
		setUri(null);
		setCodes([]);
		setCodeSaisi("");
		setNotes(false);
	};

	const demarrer = async () => {
		setEnCours(true);
		try {
			const resultat = await actions.demarrer(demandeMotDePasse ? motDePasse : undefined);
			setUri(resultat.totpURI);
			setCodes(resultat.backupCodes);
			setEtape("codes");
		} catch (erreur) {
			toast.error(message(erreur, "Activation impossible."));
		} finally {
			setEnCours(false);
		}
	};

	const confirmer = async () => {
		setEnCours(true);
		try {
			await actions.confirmer(codeSaisi.trim());
			toast.success("Double authentification active.");
			fermer();
			onChangement?.();
		} catch (erreur) {
			toast.error(message(erreur, "Code refusé — vérifie l'heure de ton téléphone."));
		} finally {
			setEnCours(false);
		}
	};

	const desactiver = async () => {
		setEnCours(true);
		try {
			await actions.desactiver(demandeMotDePasse ? motDePasse : undefined);
			toast.success("Double authentification désactivée.");
			fermer();
			onChangement?.();
		} catch (erreur) {
			toast.error(message(erreur, "Désactivation impossible."));
		} finally {
			setEnCours(false);
		}
	};

	const regenerer = async () => {
		setEnCours(true);
		try {
			const nouveaux = await actions.regenererCodes(demandeMotDePasse ? motDePasse : undefined);
			setCodes(nouveaux);
			setEtape("codes");
			setNotes(false);
			toast.success("Nouveaux codes de secours — les anciens ne valent plus rien.");
		} catch (erreur) {
			toast.error(message(erreur, "Impossible de régénérer les codes."));
		} finally {
			setEnCours(false);
		}
	};

	const copierCodes = async () => {
		try {
			await navigator.clipboard.writeText(codes.join("\n"));
			toast.success("Codes copiés.");
		} catch {
			toast.error("Copie impossible — sélectionne-les à la main.");
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{enabled ? (
						<ShieldCheck className="size-5 shrink-0 text-succes" aria-hidden />
					) : (
						<ShieldOff className="size-5 shrink-0 text-muted-foreground" aria-hidden />
					)}
					Double authentification
				</CardTitle>
				<CardDescription>
					{enabled
						? "Active. Un code temporaire est demandé à chaque connexion."
						: "Ajoute un code temporaire (Google Authenticator, Authy, 1Password) en plus de ta connexion habituelle."}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-wrap gap-2">
				<Button
					variant={enabled ? "outline" : "default"}
					onClick={() => {
						setEtape("repos");
						setOuvert(true);
					}}
				>
					{enabled ? "Désactiver" : "Activer"}
				</Button>
				{enabled && (
					<Button
						variant="outline"
						onClick={() => {
							setEtape("repos");
							setOuvert(true);
							setNotes(false);
						}}
					>
						<KeyRound className="size-4" aria-hidden />
						Nouveaux codes de secours
					</Button>
				)}
			</CardContent>

			<ResponsiveDialog
				open={ouvert}
				onOpenChange={(valeur) => (valeur ? setOuvert(true) : fermer())}
				title={enabled ? "Double authentification" : "Activer la double authentification"}
				description={
					etape === "codes"
						? "Note ces codes maintenant : ils ne seront plus jamais affichés."
						: enabled
							? "Désactive le second facteur, ou refais des codes de secours."
							: "Scanne le code avec ton application, puis saisis le code affiché."
				}
			>
				<div className="space-y-4">
					{demandeMotDePasse && etape === "repos" && (
						<div className="space-y-1.5">
							<Label htmlFor="2fa-motdepasse">Ton mot de passe</Label>
							<Input
								id="2fa-motdepasse"
								type="password"
								autoComplete="current-password"
								value={motDePasse}
								onChange={(evenement) => setMotDePasse(evenement.target.value)}
								placeholder="••••••••"
							/>
						</div>
					)}

					{etape === "repos" && (
						<div className="flex flex-wrap gap-2">
							{enabled ? (
								<>
									<Button variant="destructive" onClick={desactiver} disabled={enCours}>
										{enCours && <Loader2 className="size-4 animate-spin" aria-hidden />}
										Désactiver
									</Button>
									<Button variant="outline" onClick={regenerer} disabled={enCours}>
										Refaire des codes de secours
									</Button>
								</>
							) : (
								<Button onClick={demarrer} disabled={enCours}>
									{enCours && <Loader2 className="size-4 animate-spin" aria-hidden />}
									Continuer
								</Button>
							)}
						</div>
					)}

					{etape === "codes" && (
						<div className="space-y-4">
							{uri && (
								<div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
									<QrTotp uri={uri} />
									<div className="min-w-0 space-y-2 text-xs text-muted-foreground">
										<p>
											Scanne ce code, ou saisis la clé à la main dans ton application
											d&apos;authentification.
										</p>
										<code className="block break-all rounded-md border border-border bg-muted p-2 text-[11px]">
											{secretDeLUri(uri)}
										</code>
									</div>
								</div>
							)}

							<div className="space-y-2">
								<div className="flex items-center justify-between gap-2">
									<Label>Codes de secours</Label>
									<Button type="button" variant="outline" size="sm" onClick={copierCodes}>
										<Copy className="size-3.5" aria-hidden />
										Copier
									</Button>
								</div>
								<ul className="grid grid-cols-2 gap-1.5 rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
									{codes.map((code) => (
										<li key={code}>{code}</li>
									))}
								</ul>
								<p className="text-xs text-muted-foreground">
									Chacun ne sert qu&apos;une fois, et remplace le code temporaire si tu perds ton
									téléphone.
								</p>
							</div>

							<div className="flex items-start gap-2">
								<Checkbox
									id="2fa-notes"
									checked={notes}
									onCheckedChange={(valeur) => setNotes(valeur === true)}
								/>
								<Label htmlFor="2fa-notes" className="cursor-pointer text-xs leading-relaxed">
									J&apos;ai noté mes codes de secours en lieu sûr.
								</Label>
							</div>

							<Button
								disabled={!notes}
								onClick={() => setEtape(uri ? "verification" : "repos")}
							>
								{uri ? "Continuer" : "Terminer"}
							</Button>
						</div>
					)}

					{etape === "verification" && (
						<div className="space-y-3">
							<div className="space-y-1.5">
								<Label htmlFor="2fa-code">Code affiché par ton application</Label>
								<Input
									id="2fa-code"
									inputMode="numeric"
									autoComplete="one-time-code"
									maxLength={6}
									placeholder="123456"
									value={codeSaisi}
									onChange={(evenement) => setCodeSaisi(evenement.target.value)}
								/>
							</div>
							<Button onClick={confirmer} disabled={enCours || codeSaisi.trim().length < 6}>
								{enCours ? (
									<Loader2 className="size-4 animate-spin" aria-hidden />
								) : (
									<Check className="size-4" aria-hidden />
								)}
								Confirmer et activer
							</Button>
							<p className="text-xs text-muted-foreground">
								Tant que ce code n&apos;est pas validé, rien ne change : ta connexion reste comme
								avant.
							</p>
						</div>
					)}
				</div>
			</ResponsiveDialog>
		</Card>
	);
}

/**
 * Le QR, dessiné en SVG plutôt qu'en image.
 *
 * Un `<img>` en data-URL serait une image bitmap floue en écran dense, et la
 * politique de sécurité de contenu du site interdit `img-src data:` sur
 * certaines pages. Le SVG, lui, est du balisage : net à toute taille, imprimable
 * et lisible en thème sombre comme en thème clair (les modules prennent la
 * couleur du texte, le fond celle de la carte).
 */
function QrTotp({ uri }: { uri: string }) {
	const qr = qrcode(0, "M");
	qr.addData(uri);
	qr.make();
	const modules = qr.getModuleCount();
	const marge = 2;
	const cote = modules + marge * 2;
	const carres: string[] = [];
	for (let ligne = 0; ligne < modules; ligne += 1) {
		for (let colonne = 0; colonne < modules; colonne += 1) {
			if (qr.isDark(ligne, colonne)) {
				carres.push(`M${colonne + marge} ${ligne + marge}h1v1h-1z`);
			}
		}
	}
	return (
		<svg
			viewBox={`0 0 ${cote} ${cote}`}
			className="size-40 shrink-0 rounded-lg border border-border bg-background p-1"
			role="img"
			aria-label="Code à scanner avec ton application d'authentification"
		>
			<path d={carres.join("")} fill="currentColor" />
		</svg>
	);
}

/** Extrait la clé lisible de l'URI TOTP, pour la saisie manuelle. */
function secretDeLUri(uri: string): string {
	try {
		return new URL(uri).searchParams.get("secret") ?? uri;
	} catch {
		return uri;
	}
}

function message(erreur: unknown, defaut: string): string {
	if (erreur instanceof Error && erreur.message) {
		return erreur.message;
	}
	return defaut;
}
