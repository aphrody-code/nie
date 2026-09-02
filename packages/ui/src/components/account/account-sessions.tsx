"use client";

import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Loader2, LogOut, Monitor, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { cn } from "../../lib/utils";
import { Badge } from "../badge";
import { Button } from "../button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import type { AccountSession } from "./types";

/**
 * Résumé d'un agent utilisateur : navigateur + système + type d'appareil.
 *
 * Chaque app n'en gardait qu'une moitié — l'une affichait « Chrome — Desktop »,
 * l'autre « Windows ». Les deux sont utiles pour reconnaître une session.
 */
export function describeUserAgent(ua?: string | null): {
	browser: string;
	system: string;
	mobile: boolean;
} {
	if (!ua) {
		return { browser: "Navigateur inconnu", mobile: false, system: "Appareil inconnu" };
	}

	const mobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);

	// L'ordre compte : Edge et Opera contiennent « Chrome », Chrome contient
	// « Safari ». Du plus spécifique au plus générique.
	const browser = /Firefox\//.test(ua)
		? "Firefox"
		: /Edg\//.test(ua)
			? "Edge"
			: /OPR\/|Opera/.test(ua)
				? "Opera"
				: /Chrome\//.test(ua)
					? "Chrome"
					: /Safari\//.test(ua)
						? "Safari"
						: "Navigateur inconnu";

	const system = /iPhone/.test(ua)
		? "iPhone"
		: /iPad/.test(ua)
			? "iPad"
			: /Android/.test(ua)
				? "Android"
				: /Mac OS X/.test(ua)
					? "macOS"
					: /Windows/.test(ua)
						? "Windows"
						: /Linux/.test(ua)
							? "Linux"
							: "Appareil inconnu";

	return { browser, mobile, system };
}

interface AccountSessionsProps {
	sessions: AccountSession[];
	/**
	 * Révoque UNE session. Le paramètre est le `token`, pas l'identifiant de
	 * ligne : `revokeSession` fait `findSession(token)` et répond `{status:true}`
	 * même quand il ne trouve rien, donc un mauvais paramètre produit une
	 * révocation qui se déclare réussie sans rien révoquer.
	 */
	onRevoke: (token: string) => Promise<void>;
	/**
	 * Révoque toutes les AUTRES sessions. À câbler sur `revokeOtherSessions` et
	 * surtout pas sur `revokeSessions`, qui supprime aussi la session courante et
	 * déconnecte donc la personne qui vient de cliquer.
	 */
	onRevokeOthers: () => Promise<void>;
}

export function AccountSessions({ sessions, onRevoke, onRevokeOthers }: AccountSessionsProps) {
	const [busy, setBusy] = useState<string | null>(null);
	const others = sessions.filter((s) => !s.current);

	const run = async (key: string, action: () => Promise<void>, success: string) => {
		setBusy(key);
		try {
			await action();
			toast.success(success);
		} catch (error) {
			console.error("[compte] révocation de session en échec", error);
			toast.error("Erreur lors de la révocation.");
		} finally {
			setBusy(null);
		}
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<CardTitle>Sessions actives</CardTitle>
						<CardDescription>
							{sessions.length} session{sessions.length > 1 ? "s" : ""} ouverte
							{sessions.length > 1 ? "s" : ""}. Révoque celles que tu ne reconnais pas.
						</CardDescription>
					</div>
					{others.length > 0 && (
						<Button
							variant="outline"
							size="sm"
							disabled={busy !== null}
							onClick={() =>
								run("all", onRevokeOthers, "Toutes les autres sessions ont été révoquées.")
							}
						>
							{busy === "all" ? (
								<Loader2 className="size-4 animate-spin" aria-hidden />
							) : (
								<LogOut className="size-4" aria-hidden />
							)}
							Déconnecter les autres
						</Button>
					)}
				</div>
			</CardHeader>

			<CardContent className="space-y-3">
				{sessions.length === 0 && (
					<p className="text-sm text-muted-foreground">
						Aucune session listée. Recharge la page si tu viens de te connecter.
					</p>
				)}

				{sessions.map((session) => {
					const { browser, system, mobile } = describeUserAgent(session.userAgent);
					const Icon = mobile ? Smartphone : Monitor;

					return (
						<div
							key={session.token}
							className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
						>
							<div className="flex min-w-0 flex-1 items-start gap-3">
								<span
									className={cn(
										"flex size-9 shrink-0 items-center justify-center rounded-lg",
										session.current ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
									)}
								>
									<Icon className="size-4" aria-hidden />
								</span>
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<p className="font-semibold text-foreground">
											{browser} — {system}
										</p>
										{session.current && (
											<Badge className="bg-succes/15 text-succes">Session courante</Badge>
										)}
									</div>
									<p className="mt-0.5 text-xs text-muted-foreground">
										{session.ipAddress ?? "IP inconnue"} · ouverte{" "}
										{formatDistanceToNow(new Date(session.createdAt), {
											addSuffix: true,
											locale: fr,
										})}
									</p>
									{session.expiresAt && (
										<p className="text-xs text-muted-foreground">
											Expire le{" "}
											{format(new Date(session.expiresAt), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
										</p>
									)}
								</div>
							</div>

							{!session.current && (
								<Button
									variant="ghost"
									size="sm"
									disabled={busy !== null}
									onClick={() =>
										run(session.token, () => onRevoke(session.token), "Session révoquée.")
									}
									className="text-destructive hover:bg-destructive/10 hover:text-destructive"
								>
									{busy === session.token ? (
										<Loader2 className="size-4 animate-spin" aria-hidden />
									) : (
										<X className="size-4" aria-hidden />
									)}
									Révoquer
								</Button>
							)}
						</div>
					);
				})}
			</CardContent>
		</Card>
	);
}
