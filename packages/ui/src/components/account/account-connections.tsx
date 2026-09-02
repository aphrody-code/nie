"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Loader2, RefreshCw, Unlink } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { cn } from "../../lib/utils";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "../alert-dialog";
import { Badge } from "../badge";
import { DiscordIcon, GoogleIcon, PatreonIcon, TwitchIcon } from "../brand-icons";
import { Button } from "../button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import type { AccountLinkedAccount, AccountProviderId } from "./types";

interface ProviderMeta {
	label: string;
	description: string;
	Icon: ComponentType<SVGProps<SVGSVGElement>>;
	/** Aplat de marque derrière le logo — constante imposée par chaque marque. */
	tone: string;
}

const PROVIDER_META: Record<AccountProviderId, ProviderMeta> = {
	discord: {
		Icon: DiscordIcon,
		description: "Connexion principale et synchronisation des rôles du serveur.",
		label: "Discord",
		tone: "bg-discord/10 text-discord",
	},
	google: {
		Icon: GoogleIcon,
		description: "Connexion rapide avec ton compte Google.",
		label: "Google",
		tone: "bg-muted",
	},
	patreon: {
		Icon: PatreonIcon,
		description: "Synchronise ton palier et la remise de 20 % en boutique.",
		label: "Patreon",
		tone: "bg-patreon/10 text-patreon",
	},
	twitch: {
		Icon: TwitchIcon,
		description: "Synchronise tes suivis et abonnements.",
		label: "Twitch",
		tone: "bg-twitch/10 text-twitch",
	},
};

export interface AccountProviderConfig {
	id: AccountProviderId;
	/** Rattache le compte. Absent = le fournisseur est affiché en lecture seule. */
	onLink?: () => Promise<void> | void;
	/** Détache le compte. Absent = pas de bouton « Dissocier ». */
	onUnlink?: () => Promise<void>;
	/** Action secondaire, par exemple resynchroniser Patreon. */
	onRefresh?: () => Promise<void>;
	refreshLabel?: string;
	/** Action affichée quand le compte est déjà lié (par exemple « Voir »). */
	onView?: () => void;
	viewLabel?: string;
}

interface AccountConnectionsProps {
	providers: AccountProviderConfig[];
	accounts: AccountLinkedAccount[];
}

export function AccountConnections({ providers, accounts }: AccountConnectionsProps) {
	const [busy, setBusy] = useState<string | null>(null);
	const [confirmUnlink, setConfirmUnlink] = useState<AccountProviderId | null>(null);

	const linkedCount = providers.filter((p) =>
		accounts.some((a) => a.provider === p.id)
	).length;

	const run = async (key: string, action: () => Promise<void> | void) => {
		setBusy(key);
		try {
			await action();
		} catch (error) {
			console.error(`[compte] action « ${key} » en échec`, error);
			toast.error(error instanceof Error ? error.message : "Opération impossible.");
		} finally {
			setBusy(null);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Comptes liés</CardTitle>
				<CardDescription>
					Relie tes comptes externes pour te connecter plus vite et synchroniser tes avantages. Le
					dernier compte rattaché ne peut pas être dissocié — il ne resterait aucun moyen de se
					connecter.
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-3">
				{providers.map((provider) => {
					const meta = PROVIDER_META[provider.id];
					const account = accounts.find((a) => a.provider === provider.id);
					const isLinked = Boolean(account);
					const isLast = isLinked && linkedCount === 1;

					return (
						<div
							key={provider.id}
							className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
						>
							<div className="flex min-w-0 flex-1 items-start gap-3">
								<span className={cn("shrink-0 rounded-xl p-2.5", meta.tone)}>
									<meta.Icon className="size-5" />
								</span>
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<p className="font-semibold text-foreground">{meta.label}</p>
										{isLinked ? (
											<Badge className="bg-succes/15 text-succes">Connecté</Badge>
										) : (
											<Badge variant="outline" className="text-muted-foreground">
												Non connecté
											</Badge>
										)}
									</div>
									<p className="mt-1 text-xs text-muted-foreground">{meta.description}</p>
									{account?.createdAt && (
										<p className="mt-1 text-xs text-muted-foreground">
											Lié le {format(new Date(account.createdAt), "d MMMM yyyy", { locale: fr })}
										</p>
									)}
								</div>
							</div>

							<div className="flex flex-wrap items-center gap-2">
								{isLinked && provider.onRefresh && (
									<Button
										size="sm"
										variant="outline"
										disabled={busy !== null}
										onClick={() => run(`${provider.id}:refresh`, provider.onRefresh!)}
									>
										{busy === `${provider.id}:refresh` ? (
											<Loader2 className="size-4 animate-spin" aria-hidden />
										) : (
											<RefreshCw className="size-4" aria-hidden />
										)}
										{provider.refreshLabel ?? "Synchroniser"}
									</Button>
								)}

								{isLinked && provider.onView && (
									<Button size="sm" variant="outline" onClick={provider.onView}>
										{provider.viewLabel ?? "Voir"}
									</Button>
								)}

								{!isLinked && provider.onLink && (
									<Button
										size="sm"
										disabled={busy !== null}
										onClick={() => run(`${provider.id}:link`, provider.onLink!)}
									>
										{busy === `${provider.id}:link` && (
											<Loader2 className="size-4 animate-spin" aria-hidden />
										)}
										Lier
									</Button>
								)}

								{isLinked && provider.onUnlink && !isLast && (
									<Button
										size="sm"
										variant="outline"
										disabled={busy !== null}
										onClick={() => setConfirmUnlink(provider.id)}
									>
										<Unlink className="size-4" aria-hidden />
										Dissocier
									</Button>
								)}

								{isLast && (
									<p className="text-xs text-muted-foreground">Compte principal</p>
								)}
							</div>
						</div>
					);
				})}

				<AlertDialog
					open={confirmUnlink !== null}
					onOpenChange={(open) => {
						if (!open) {
							setConfirmUnlink(null);
						}
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								Dissocier {confirmUnlink ? PROVIDER_META[confirmUnlink].label : "ce compte"} ?
							</AlertDialogTitle>
							<AlertDialogDescription>
								Tu pourras le relier à tout moment. Les données déjà synchronisées restent en base
								mais ne seront plus rafraîchies.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={busy !== null}>Annuler</AlertDialogCancel>
							<AlertDialogAction
								disabled={busy !== null}
								onClick={(event) => {
									event.preventDefault();
									const id = confirmUnlink;
									const handler = providers.find((p) => p.id === id)?.onUnlink;
									if (!id || !handler) {
										return;
									}
									void run(`${id}:unlink`, handler).then(() => setConfirmUnlink(null));
								}}
							>
								{busy?.endsWith(":unlink") && (
									<Loader2 className="size-4 animate-spin" aria-hidden />
								)}
								Dissocier
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</CardContent>
		</Card>
	);
}
