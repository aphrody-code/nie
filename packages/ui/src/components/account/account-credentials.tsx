"use client";

import { KeyRound, Loader2, Mail } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "../button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import { Input } from "../input";
import { Label } from "../label";
import type { AccountActionResult } from "./types";

interface AccountEmailCardProps {
	currentEmail?: string | null;
	onChangeEmail: (newEmail: string) => Promise<AccountActionResult>;
}

export function AccountEmailCard({ currentEmail, onChangeEmail }: AccountEmailCardProps) {
	const fieldId = useId();
	const [newEmail, setNewEmail] = useState("");
	const [pending, setPending] = useState(false);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!newEmail || newEmail === currentEmail) {
			toast.error("Saisis une adresse différente de l'actuelle.");
			return;
		}
		setPending(true);
		try {
			const res = await onChangeEmail(newEmail);
			if (res?.error) {
				toast.error(res.error);
				return;
			}
			toast.success("Ouvre le lien envoyé à ton adresse actuelle pour confirmer le changement.");
			setNewEmail("");
		} catch (error) {
			console.error("[compte] changement d'adresse en échec", error);
			toast.error("Erreur lors du changement d'adresse.");
		} finally {
			setPending(false);
		}
	};

	return (
		<Card className="h-full">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Mail className="size-5 shrink-0 text-muted-foreground" aria-hidden />
					Adresse e-mail
				</CardTitle>
				{/* Le lien part vers l'adresse ACTUELLE, pas la nouvelle : c'est elle
				    qui autorise le changement, sinon quiconque prend la main sur une
				    session ouverte déplacerait le compte vers sa propre boîte. La carte
				    annonçait l'inverse et envoyait donc regarder la mauvaise boîte —
				    les 33 comptes du site ont tous une adresse vérifiée, personne n'est
				    dans le cas où le changement s'applique directement. */}
				<CardDescription>
					Un lien de confirmation part vers ton adresse <strong>actuelle</strong> : le changement ne
					prend effet qu'une fois ce lien ouvert. Une vérification est ensuite envoyée à la
					nouvelle.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={submit} className="space-y-4">
					<div className="rounded-lg border border-border bg-muted/40 p-3">
						<p className="text-xs font-medium text-muted-foreground">Adresse actuelle</p>
						<p className="truncate font-semibold text-foreground" title={currentEmail ?? undefined}>
							{currentEmail ?? "—"}
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor={fieldId}>Nouvelle adresse</Label>
						<Input
							id={fieldId}
							type="email"
							autoComplete="email"
							placeholder="nouvelle@exemple.com"
							value={newEmail}
							onChange={(e) => setNewEmail(e.target.value)}
						/>
					</div>
					<Button type="submit" disabled={pending || !newEmail} className="w-full rounded-full">
						{pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
						Changer l'adresse
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

interface AccountPasswordCardProps {
	minLength?: number;
	onChangePassword: (input: {
		currentPassword: string;
		newPassword: string;
	}) => Promise<AccountActionResult>;
}

export function AccountPasswordCard({
	minLength = 8,
	onChangePassword,
}: AccountPasswordCardProps) {
	const currentId = useId();
	const newId = useId();
	const confirmId = useId();
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");
	const [pending, setPending] = useState(false);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (next !== confirm) {
			toast.error("Les deux mots de passe ne correspondent pas.");
			return;
		}
		if (next.length < minLength) {
			toast.error(`Le mot de passe doit contenir au moins ${minLength} caractères.`);
			return;
		}
		setPending(true);
		try {
			const res = await onChangePassword({ currentPassword: current, newPassword: next });
			if (res?.error) {
				toast.error(res.error);
				return;
			}
			toast.success("Mot de passe mis à jour.");
			setCurrent("");
			setNext("");
			setConfirm("");
		} catch (error) {
			console.error("[compte] changement de mot de passe en échec", error);
			toast.error("Erreur lors du changement de mot de passe.");
		} finally {
			setPending(false);
		}
	};

	return (
		<Card className="h-full">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<KeyRound className="size-5 shrink-0 text-muted-foreground" aria-hidden />
					Mot de passe
				</CardTitle>
				<CardDescription>
					Le mot de passe actuel est obligatoire : le serveur le vérifie avant d'accepter le
					nouveau.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={submit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor={currentId}>Mot de passe actuel</Label>
						<Input
							id={currentId}
							type="password"
							autoComplete="current-password"
							placeholder="••••••••"
							value={current}
							onChange={(e) => setCurrent(e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor={newId}>Nouveau mot de passe</Label>
						<Input
							id={newId}
							type="password"
							autoComplete="new-password"
							minLength={minLength}
							placeholder="••••••••"
							value={next}
							onChange={(e) => setNext(e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor={confirmId}>Confirmer</Label>
						<Input
							id={confirmId}
							type="password"
							autoComplete="new-password"
							placeholder="••••••••"
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						Au moins {minLength} caractères.
					</p>
					<Button
						type="submit"
						disabled={pending || !current || !next || !confirm}
						className="w-full rounded-full"
					>
						{pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
						Changer le mot de passe
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
