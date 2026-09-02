"use client";

import {
	AccountAvatarCard,
	AccountConnections,
	AccountDangerZone,
	AccountEmailCard,
	AccountPasswordCard,
	AccountProfileForm,
	type AccountProviderConfig,
	AccountSessions,
	AccountShell,
	type AccountLinkedAccount,
	type AccountProfileValues,
	type AccountSession,
	type AccountTabId,
	TwoFactorCard,
} from "@rosegriffon/ui";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { createClient } from "@/lib/supabase/client";

import { updateAvatarUrl, updateProfile } from "./actions";

interface AccountClientProps {
	userId: string;
	email?: string | null;
	initialTab: AccountTabId;
	avatarUrl: string | null;
	username: string | null;
	role: string | null;
	twoFactorEnabled: boolean;
	hasPassword: boolean;
	profile: AccountProfileValues;
	accounts: AccountLinkedAccount[];
	sessions: AccountSession[];
}

/**
 * Câblage côté wiki de la page « Mon compte » partagée avec le site principal.
 *
 * Pas d'onglet Adresse ici : le wiki n'expédie rien, collecter une adresse
 * postale n'y aurait aucun usage.
 */
export function AccountClient({
	userId,
	email,
	initialTab,
	avatarUrl,
	username,
	role,
	twoFactorEnabled,
	hasPassword,
	profile,
	accounts,
	sessions,
}: AccountClientProps) {
	const router = useRouter();
	const reload = () => router.refresh();

	const uploadAvatar = async (file: File) => {
		const supabase = createClient();
		const extension = file.name.split(".").pop()?.toLowerCase() ?? "png";
		// Nom unique : un chemin fixe renverrait la même URL publique, que le
		// navigateur et le CDN resservent depuis leur cache.
		const path = `${userId}/avatar-${Date.now()}.${extension}`;

		const { error: uploadError } = await supabase.storage
			.from("avatars")
			.upload(path, file, { contentType: file.type, upsert: true });
		if (uploadError) {
			throw new Error(uploadError.message);
		}

		const {
			data: { publicUrl },
		} = supabase.storage.from("avatars").getPublicUrl(path);

		const res = await updateAvatarUrl(publicUrl);
		if (res.error) {
			throw new Error(res.error);
		}
		reload();
		return publicUrl;
	};

	const link = async (provider: "discord" | "google") => {
		const { error } = await authClient.linkSocial({
			callbackURL: "/settings?tab=connections",
			provider,
		});
		if (error) {
			throw new Error(error.message ?? "Impossible de lier ce compte.");
		}
	};

	const unlink = async (providerId: string) => {
		const { error } = await authClient.unlinkAccount({ providerId });
		if (error) {
			throw new Error(error.message ?? "Impossible de dissocier ce compte.");
		}
		toast.success("Compte dissocié.");
		reload();
	};

	const providers: AccountProviderConfig[] = [
		{ id: "discord", onLink: () => link("discord"), onUnlink: () => unlink("discord") },
		{ id: "google", onLink: () => link("google"), onUnlink: () => unlink("google") },
	];

	/**
	 * La carte de double authentification, définie UNE fois.
	 *
	 * Elle est rendue à deux endroits selon le compte : à côté de l'adresse
	 * e-mail quand il n'y a pas de mot de passe (la place qu'occuperait la carte
	 * mot de passe), sur sa propre ligne sinon. Recopier le bloc aux deux
	 * endroits, c'était garantir qu'une correction n'en toucherait qu'un.
	 */
	const carteDoubleFacteur = (
		<TwoFactorCard
			enabled={twoFactorEnabled}
			// Azalée ouvre l'inscription par e-mail : un compte qui a un mot de
			// passe doit le fournir, Better Auth l'exige. Un compte purement OAuth
			// n'en a aucun à donner — le réclamer le refuserait pour rien.
			demandeMotDePasse={hasPassword}
			onChangement={reload}
			actions={{
				demarrer: async (motDePasse) => {
					const { data, error } = await authClient.twoFactor.enable({
						password: motDePasse ?? "",
					});
					if (error || !data) {
						throw new Error(error?.message ?? "Activation impossible.");
					}
					return { backupCodes: data.backupCodes, totpURI: data.totpURI };
				},
				confirmer: async (code) => {
					const { error } = await authClient.twoFactor.verifyTotp({ code });
					if (error) {
						throw new Error(error.message ?? "Code refusé.");
					}
				},
				desactiver: async (motDePasse) => {
					const { error } = await authClient.twoFactor.disable({
						password: motDePasse ?? "",
					});
					if (error) {
						throw new Error(error.message ?? "Désactivation impossible.");
					}
				},
				regenererCodes: async (motDePasse) => {
					const { data, error } = await authClient.twoFactor.generateBackupCodes({
						password: motDePasse ?? "",
					});
					if (error || !data) {
						throw new Error(error?.message ?? "Impossible de régénérer les codes.");
					}
					return data.backupCodes;
				},
			}}
		/>
	);

	return (
		<AccountShell
			email={email}
			backHref={username ? `/profil/${username}` : "/"}
			backLabel="Retour à mon profil"
			initialTab={initialTab}
			tabs={[
				{
					content: (
						<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
							<div className="lg:col-span-1">
								<AccountAvatarCard
									avatarUrl={avatarUrl}
									username={username}
									role={role}
									// Le wiki a sa propre page publique, à la même adresse.
									profileHref={username ? `/profil/${username}` : null}
									onUpload={uploadAvatar}
								/>
							</div>
							<div className="lg:col-span-2">
								<AccountProfileForm
									values={profile}
									profileUrlPrefix="/profil/"
									onSubmit={async (values) => updateProfile(values)}
								/>
							</div>
						</div>
					),
					id: "profile",
				},
				{
					content: <AccountConnections providers={providers} accounts={accounts} />,
					id: "connections",
				},
				{
					content: (
						<div className="space-y-6">
							<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
								<AccountEmailCard
									currentEmail={email}
									onChangeEmail={async (newEmail) => {
										const { error } = await authClient.changeEmail({
											callbackURL: "/settings?tab=security",
											newEmail,
										});
										return { error: error?.message ?? null };
									}}
								/>
								{/* Carte mot de passe réservée aux comptes qui en ont un : sur un
								    compte purement OAuth, l'endpoint répond `CREDENTIAL_ACCOUNT_NOT_FOUND`. */}
								{hasPassword ? (
									<AccountPasswordCard
										onChangePassword={async ({ currentPassword, newPassword }) => {
											const { error } = await authClient.changePassword({
												currentPassword,
												newPassword,
												// Déconnecte les autres appareils : un mot de passe changé
												// après une compromission doit invalider les sessions volées.
												revokeOtherSessions: true,
											});
											return { error: error?.message ?? null };
										}}
									/>
								) : (
									carteDoubleFacteur
								)}
							</div>

							{hasPassword && carteDoubleFacteur}

							<AccountSessions
								sessions={sessions}
								onRevoke={async (token) => {
									// `revokeSession` NE LÈVE PAS : il rend `{ data, error }`. Sans
									// cette vérification, un refus du serveur ressortait en
									// « Session révoquée » et la session restait ouverte.
									const { error } = await authClient.revokeSession({ token });
									if (error) {
										throw new Error(error.message ?? "Révocation refusée.");
									}
									reload();
								}}
								onRevokeOthers={async () => {
									// `revokeOtherSessions` et non `revokeSessions` : le second
									// supprime aussi la session courante et déconnecte.
									const { error } = await authClient.revokeOtherSessions();
									if (error) {
										throw new Error(error.message ?? "Révocation refusée.");
									}
									reload();
								}}
							/>

							<AccountDangerZone
								losses={[
									"Ton profil, ta bio et ton avatar.",
									"Tes équipes enregistrées et tes préférences.",
									"Tes commentaires sur les actualités.",
								]}
								onDelete={async () => {
									const { error } = await authClient.deleteUser({ callbackURL: "/" });
									return { error: error?.message ?? null };
								}}
							/>
						</div>
					),
					id: "security",
				},
			]}
		/>
	);
}
