"use client";

import { ArrowLeft, KeyRound, Loader2, Lock, LogIn, Mail, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@rosegriffon/ui";
import { authClient } from "@/lib/auth-client";

type AuthMode = "login" | "signup" | "forgot-password";

/**
 * Validate that returnTo is a safe relative path (no external redirects).
 */
function sanitizeReturnTo(returnTo?: string): string {
	if (!returnTo) {
		return "/";
	}
	// Must start with / and not be a protocol-relative URL
	if (!returnTo.startsWith("/") || returnTo.startsWith("//")) {
		return "/";
	}
	return returnTo;
}

interface LoginFormProps {
	onSuccess?: () => void;
	returnTo?: string;
}

export function LoginForm({ onSuccess, returnTo }: LoginFormProps) {
	const router = useRouter();
	const safeReturnTo = sanitizeReturnTo(returnTo);
	// Résolveur serveur : décide /dashboard (admin) vs returnTo selon le rôle réel.
	const postLoginUrl = returnTo
		? `/auth/post-login?returnTo=${encodeURIComponent(safeReturnTo)}`
		: "/auth/post-login";
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [loading, setLoading] = useState(false);
	const [mode, setMode] = useState<AuthMode>("login");

	const handleOAuthLogin = async (provider: "discord" | "google") => {
		try {
			setLoading(true);
			const { error } = await authClient.signIn.social({
				callbackURL: postLoginUrl,
				provider,
			});
			if (error) {
				console.error("Login error:", error);
				toast.error(`Erreur lors de la connexion via ${provider}`);
				setLoading(false);
			}
			// Si pas d'erreur, le navigateur redirige vers Discord/Google — loading reste true
		} catch (error: unknown) {
			console.error("Login error:", error);
			toast.error(`Erreur lors de la connexion via ${provider}`);
			setLoading(false);
		}
	};

	const handleEmailAuth = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email) {
			return;
		}

		try {
			setLoading(true);

			if (mode === "forgot-password") {
				const { error } = await authClient.requestPasswordReset({
					email,
					redirectTo: "/auth/reset-password",
				});
				if (error) {
					toast.error(error.message || "Erreur lors de l'envoi.");
				} else {
					toast.success(
						"Si un compte existe avec cet email, tu recevras un lien de réinitialisation."
					);
				}
				return;
			}

			if (!password) {
				return;
			}

			if (mode === "signup") {
				const { error } = await authClient.signUp.email({
					email,
					name: name || email.split("@")[0],
					password,
				});
				if (error) {
					throw new Error(error.message);
				}
				toast.success("Compte créé ! Tu es maintenant connecté.");
				if (onSuccess) {
					onSuccess();
				}
				router.push(safeReturnTo);
			} else {
				const { error } = await authClient.signIn.email({
					email,
					password,
				});
				if (error) {
					throw new Error(error.message);
				}
				toast.success("Connexion réussie !");
				if (onSuccess) {
					onSuccess();
				}
				// Résolveur serveur : navigation complète (cookies envoyés) → /dashboard si
				// admin, sinon returnTo. Évite la race du isAdmin client de la page /login.
				window.location.href = postLoginUrl;
			}
		} catch (error: unknown) {
			console.error("Auth error:", error);
			const errorMessage = error instanceof Error ? error.message : "Une erreur est survenue";
			toast.error(errorMessage);
		} finally {
			setLoading(false);
		}
	};

	const needsPassword = mode === "login" || mode === "signup";

	return (
		<div className="flex flex-col gap-6 w-full">
			{/* OAuth buttons - only show on login/signup */}
			{(mode === "login" || mode === "signup") && (
				<>
					<div className="flex flex-col gap-3">
						<Button
							variant="outline"
							className="h-12 rounded-full border-outline-variant bg-surface-container-lowest hover:bg-surface-container hover:elevation-1 transition-all duration-200 ease-[var(--ease-standard)] disabled:opacity-38"
							onClick={() => handleOAuthLogin("discord")}
							disabled={loading}
						>
							<svg className="size-5 mr-3" viewBox="0 0 24 24" fill="#5865F2">
								<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
							</svg>
							<span className="type-label-large flex-1 text-left">Continuer avec Discord</span>
						</Button>

						<Button
							variant="outline"
							className="h-12 rounded-full border-outline-variant bg-surface-container-lowest hover:bg-surface-container hover:elevation-1 transition-all duration-200 ease-[var(--ease-standard)] disabled:opacity-38"
							onClick={() => handleOAuthLogin("google")}
							disabled={loading}
						>
							<svg className="size-5 mr-3" viewBox="0 0 48 48">
								<path
									fill="#EA4335"
									d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
								/>
								<path
									fill="#4285F4"
									d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
								/>
								<path
									fill="#FBBC05"
									d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
								/>
								<path
									fill="#34A853"
									d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
								/>
							</svg>
							<span className="type-label-large flex-1 text-left">Continuer avec Google</span>
						</Button>

					</div>

					{/* Separator */}
					<div className="relative my-2">
						<div className="absolute inset-0 flex items-center">
							<span className="w-full border-t border-outline-variant" />
						</div>
						<div className="relative flex justify-center">
							<span className="bg-surface-container-lowest px-4 type-label-medium text-on-surface-variant">
								ou
							</span>
						</div>
					</div>
				</>
			)}

			{/* Back button for secondary modes */}
			{mode === "forgot-password" && (
				<button
					type="button"
					onClick={() => setMode("login")}
					className="flex items-center gap-2 type-label-large text-on-surface-variant hover:text-on-surface transition-colors self-start"
				>
					<ArrowLeft className="size-4" />
					Retour à la connexion
				</button>
			)}

			{/* Mode header for forgot-password */}
			{mode === "forgot-password" && (
				<div className="text-center space-y-2">
					<div className="mx-auto size-12 rounded-2xl bg-error-container flex items-center justify-center">
						<KeyRound className="size-6 text-on-error-container" />
					</div>
					<h3 className="type-title-large text-on-surface font-bold">Mot de passe oublié</h3>
					<p className="type-body-medium text-on-surface-variant">
						Entre ton adresse email pour recevoir un lien de réinitialisation.
					</p>
				</div>
			)}

			{/* Email/Password Form */}
			<form onSubmit={handleEmailAuth} className="space-y-4">
				<div className="space-y-4">
					{mode === "signup" && (
						<div className="relative">
							<label htmlFor="name" className="type-body-small text-on-surface-variant mb-2 block">
								Nom d&apos;utilisateur
							</label>
							<div className="relative group">
								<Input
									id="name"
									type="text"
									placeholder="Ton pseudo"
									className="h-14 pl-4 pr-4 rounded-xl border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 type-body-large text-on-surface placeholder:text-on-surface-variant/60"
									value={name}
									onChange={(e) => setName(e.target.value)}
									disabled={loading}
								/>
							</div>
						</div>
					)}

					<div className="relative">
						<label htmlFor="email" className="type-body-small text-on-surface-variant mb-2 block">
							Adresse e-mail
						</label>
						<div className="relative group">
							<Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-on-surface-variant group-focus-within:text-primary transition-colors duration-200" />
							<Input
								id="email"
								type="email"
								placeholder="exemple@email.com"
								className="h-14 pl-12 pr-4 rounded-xl border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 type-body-large text-on-surface placeholder:text-on-surface-variant/60"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								disabled={loading}
								required
							/>
						</div>
					</div>

					{needsPassword && (
						<div className="relative">
							<div className="flex items-center justify-between mb-2">
								<label htmlFor="password" className="type-body-small text-on-surface-variant">
									Mot de passe
								</label>
								{mode === "login" && (
									<button
										type="button"
										onClick={() => setMode("forgot-password")}
										className="type-body-small text-primary hover:underline transition-all"
									>
										Mot de passe oublié ?
									</button>
								)}
							</div>
							<div className="relative group">
								<Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-on-surface-variant group-focus-within:text-primary transition-colors duration-200" />
								<Input
									id="password"
									type="password"
									placeholder="••••••••"
									className="h-14 pl-12 pr-4 rounded-xl border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all duration-200 type-body-large text-on-surface placeholder:text-on-surface-variant/60"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									disabled={loading}
									required
								/>
							</div>
						</div>
					)}
				</div>

				<Button
					type="submit"
					disabled={loading}
					className="w-full h-12 rounded-full bg-primary text-on-primary hover:elevation-1 hover:brightness-105 active:elevation-0 disabled:opacity-38 type-label-large font-medium transition-all duration-300 ease-[var(--ease-emphasized)]"
				>
					{loading ? (
						<>
							<Loader2 className="mr-2 size-5 animate-spin" />
							Chargement...
						</>
					) : mode === "signup" ? (
						<>
							<UserPlus className="mr-2 size-5" />
							Créer un compte
						</>
					) : mode === "forgot-password" ? (
						<>
							<Mail className="mr-2 size-5" />
							Envoyer le lien
						</>
					) : (
						<>
							<LogIn className="mr-2 size-5" />
							Se connecter
						</>
					)}
				</Button>

				{/* Mode switching links */}
				{(mode === "login" || mode === "signup") && (
					<div className="flex flex-col gap-2 pt-1">
						<button
							type="button"
							onClick={() => setMode(mode === "signup" ? "login" : "signup")}
							className="w-full text-center type-body-small text-primary hover:underline transition-all"
						>
							{mode === "signup"
								? "Déjà un compte ? Se connecter"
								: "Pas encore de compte ? S'inscrire"}
						</button>
					</div>
				)}
			</form>

			{/* Legal notice */}
			{(mode === "login" || mode === "signup") && (
				<p className="type-body-small text-center text-on-surface-variant leading-relaxed">
					En vous connectant, vous acceptez les{" "}
					<Link href="/legal/cgu" className="text-primary hover:underline">
						conditions d&apos;utilisation
					</Link>{" "}
					d&apos;Azalée.
				</p>
			)}
		</div>
	);
}
