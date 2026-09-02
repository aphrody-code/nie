"use client";

import { CheckCircle, KeyRound, Loader2, Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@rosegriffon/ui";
import { authClient } from "@/lib/auth-client";

function ResetPasswordContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const token = searchParams.get("token") || "";

	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);

	const handleReset = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!token) {
			toast.error("Lien de réinitialisation invalide.");
			return;
		}

		if (newPassword.length < 8) {
			toast.error("Le mot de passe doit faire au moins 8 caractères.");
			return;
		}

		if (newPassword !== confirmPassword) {
			toast.error("Les mots de passe ne correspondent pas.");
			return;
		}

		setLoading(true);
		try {
			const { error } = await authClient.resetPassword({
				newPassword,
				token,
			});
			if (error) {
				toast.error(error.message || "Erreur lors de la réinitialisation.");
			} else {
				setSuccess(true);
				toast.success("Mot de passe modifié avec succès !");
				setTimeout(() => router.push("/login"), 2000);
			}
		} catch {
			toast.error("La réinitialisation a échoué. Réessaie.");
		}
		setLoading(false);
	};

	if (!token) {
		return (
			<div className="flex min-h-screen w-full items-center justify-center bg-surface-container-low p-4">
				<div className="w-full max-w-[440px] text-center space-y-4">
					<div className="mx-auto size-16 rounded-2xl bg-error-container flex items-center justify-center">
						<KeyRound className="size-8 text-on-error-container" />
					</div>
					<h1 className="type-headline-small text-on-surface">Lien invalide</h1>
					<p className="type-body-medium text-on-surface-variant">
						Ce lien de réinitialisation est invalide ou a expiré.
					</p>
					<Button
						onClick={() => router.push("/login")}
						className="rounded-full bg-primary text-on-primary"
					>
						Retour à la connexion
					</Button>
				</div>
			</div>
		);
	}

	if (success) {
		return (
			<div className="flex min-h-screen w-full items-center justify-center bg-surface-container-low p-4">
				<div className="w-full max-w-[440px] text-center space-y-4">
					<div className="mx-auto size-16 rounded-2xl bg-primary/10 flex items-center justify-center">
						<CheckCircle className="size-8 text-primary" />
					</div>
					<h1 className="type-headline-small text-on-surface">Mot de passe modifié</h1>
					<p className="type-body-medium text-on-surface-variant">
						Tu vas être redirigé vers la page de connexion...
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen w-full items-center justify-center bg-surface-container-low p-4">
			<div className="w-full max-w-[440px] overflow-hidden">
				<div className="bg-surface-container-lowest rounded-[28px] elevation-2 overflow-hidden">
					{/* Header */}
					<div className="relative px-8 pt-10 pb-8 text-center overflow-hidden">
						<div className="absolute inset-0 bg-linear-to-b from-primary/5 to-transparent" />
						<div className="relative space-y-4">
							<div className="mx-auto size-12 rounded-2xl bg-primary/10 flex items-center justify-center">
								<KeyRound className="size-6 text-primary" />
							</div>
							<div>
								<h1 className="type-headline-small text-on-surface mb-1">Nouveau mot de passe</h1>
								<p className="type-body-medium text-on-surface-variant">
									Choisis un nouveau mot de passe pour ton compte.
								</p>
							</div>
						</div>
					</div>

					{/* Form */}
					<div className="px-8 pb-8">
						<form onSubmit={handleReset} className="space-y-4">
							<div className="space-y-3">
								<label
									htmlFor="new-password"
									className="type-body-small text-on-surface-variant block"
								>
									Nouveau mot de passe
								</label>
								<div className="relative group">
									<Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-on-surface-variant group-focus-within:text-primary transition-colors duration-200" />
									<Input
										id="new-password"
										type="password"
										placeholder="••••••••"
										className="h-14 pl-12 pr-4 rounded-xl border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 type-body-large"
										value={newPassword}
										onChange={(e) => setNewPassword(e.target.value)}
										disabled={loading}
										required
										minLength={8}
									/>
								</div>
							</div>

							<div className="space-y-3">
								<label
									htmlFor="confirm-password"
									className="type-body-small text-on-surface-variant block"
								>
									Confirmer le mot de passe
								</label>
								<div className="relative group">
									<Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-on-surface-variant group-focus-within:text-primary transition-colors duration-200" />
									<Input
										id="confirm-password"
										type="password"
										placeholder="••••••••"
										className="h-14 pl-12 pr-4 rounded-xl border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 type-body-large"
										value={confirmPassword}
										onChange={(e) => setConfirmPassword(e.target.value)}
										disabled={loading}
										required
										minLength={8}
									/>
								</div>
							</div>

							<Button
								type="submit"
								disabled={loading || !newPassword || !confirmPassword}
								className="w-full h-12 rounded-full bg-primary text-on-primary hover:elevation-1 hover:brightness-105 disabled:opacity-38 type-label-large font-medium transition-all duration-300"
							>
								{loading ? (
									<>
										<Loader2 className="mr-2 size-5 animate-spin" />
										Réinitialisation...
									</>
								) : (
									<>
										<KeyRound className="mr-2 size-5" />
										Réinitialiser le mot de passe
									</>
								)}
							</Button>
						</form>
					</div>
				</div>

				<p className="type-body-small text-center text-on-surface-variant/60 mt-6">
					Azalée &mdash; Rose Griffon
				</p>
			</div>
		</div>
	);
}

export default function ResetPasswordPage() {
	return (
		<Suspense>
			<ResetPasswordContent />
		</Suspense>
	);
}
