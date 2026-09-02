"use client";

import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "../button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import { Input } from "../input";
import { Label } from "../label";
import type { AccountActionResult } from "./types";

/** Mot que l'utilisateur doit recopier pour armer la suppression. */
const CONFIRM_WORD = "SUPPRIMER";

interface AccountDangerZoneProps {
	/**
	 * Déclenche la suppression. L'app doit envoyer un lien de confirmation par
	 * e-mail plutôt que de supprimer immédiatement : sans cela, la suppression
	 * dépend de la fraîcheur de la session et échoue en `SESSION_EXPIRED` sur
	 * les sessions longues.
	 */
	onDelete: () => Promise<AccountActionResult>;
	/** Ce qui sera perdu, listé explicitement pour un consentement éclairé. */
	losses?: string[];
	/**
	 * Ce qui SURVIT à la suppression.
	 *
	 * Dire seulement ce qu'on perd laisse croire que tout disparaît. Les
	 * commandes de la boutique, elles, restent — détachées du compte, parce
	 * qu'une facture doit pouvoir être retrouvée. Le taire, c'est promettre un
	 * effacement total qui n'a pas lieu.
	 */
	kept?: string[];
}

export function AccountDangerZone({ onDelete, losses, kept }: AccountDangerZoneProps) {
	const fieldId = useId();
	const [confirm, setConfirm] = useState("");
	const [pending, setPending] = useState(false);

	const armed = confirm.trim() === CONFIRM_WORD;

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!armed) {
			return;
		}
		setPending(true);
		try {
			const res = await onDelete();
			if (res?.error) {
				toast.error(res.error);
				return;
			}
			toast.success("Demande enregistrée : confirme la suppression depuis l'e-mail reçu.");
			setConfirm("");
		} catch (error) {
			console.error("[compte] suppression en échec", error);
			toast.error("Erreur lors de la demande de suppression.");
		} finally {
			setPending(false);
		}
	};

	return (
		<Card className="border-destructive/40">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-destructive">
					<AlertTriangle className="size-5 shrink-0" aria-hidden />
					Zone de danger
				</CardTitle>
				<CardDescription>Actions irréversibles sur ton compte.</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={submit} className="space-y-4">
					<div className="space-y-2 text-sm text-muted-foreground">
						<p>
							La suppression du compte est <strong className="text-destructive">définitive</strong>.
						</p>
						{losses && losses.length > 0 && (
							<ul className="list-disc space-y-1 pl-5">
								{losses.map((loss) => (
									<li key={loss}>{loss}</li>
								))}
							</ul>
						)}
						{kept && kept.length > 0 && (
							<ul className="list-disc space-y-1 pl-5 text-muted-foreground/80">
								{kept.map((entree) => (
									<li key={entree}>{entree}</li>
								))}
							</ul>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor={fieldId}>
							Tape <span className="font-bold text-destructive">{CONFIRM_WORD}</span> pour confirmer
						</Label>
						<Input
							id={fieldId}
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
							placeholder={CONFIRM_WORD}
							autoComplete="off"
							aria-describedby={`${fieldId}-aide`}
							className="border-destructive/40 focus-visible:border-destructive"
						/>
						<p id={`${fieldId}-aide`} className="text-xs text-muted-foreground">
							Le bouton reste inactif tant que le mot n'est pas exact.
						</p>
					</div>

					<Button
						type="submit"
						variant="destructive"
						disabled={pending || !armed}
						className="w-full rounded-full"
					>
						{pending ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							<Trash2 className="size-4" aria-hidden />
						)}
						Supprimer définitivement mon compte
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
