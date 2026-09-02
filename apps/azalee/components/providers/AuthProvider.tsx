"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";
import { useSupabase } from "@/hooks/use-supabase";
import { authClient } from "@/lib/auth-client";
import { ADMIN_ROLES } from "@/lib/auth-roles";
import { PUBLIC_PROFILE_COLUMNS, type PublicProfile } from "@rosegriffon/db";

// Le client navigateur (clé anon) ne lit QUE les colonnes publiques :
// typer avec la ligne complète promettait adresse et e-mail, que la
// requête ne ramène jamais depuis la fermeture PII.
export type AzaleeProfile = PublicProfile;

// Better Auth user type
export interface BetterAuthUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

interface AuthContextType {
	user: BetterAuthUser | null;
	profile: AzaleeProfile | null;
	loading: boolean;
	signOut: () => Promise<void>;
	isAdmin: boolean;
	refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({
	children,
	initialUser = null,
	initialProfile = null,
}: {
	children: ReactNode;
	initialUser?: BetterAuthUser | null;
	initialProfile?: AzaleeProfile | null;
}) {
	const [user, setUser] = useState<BetterAuthUser | null>(initialUser);
	const [profile, setProfile] = useState<AzaleeProfile | null>(initialProfile);
	const [loading, setLoading] = useState(!initialUser);
	const supabase = useSupabase();
	const router = useRouter();

	const fetchProfile = useCallback(
		async (userId: string) => {
			try {
				const { data, error } = await supabase
					.from("profiles")
					// Depuis la fermeture PII, un `select("*")` en clé anon échoue
					// entièrement (42501) : profile restait null, donc avatar générique
					// pour tous et `isAdmin` toujours faux (bouton Admin jamais affiché).
					.select(PUBLIC_PROFILE_COLUMNS)
					.eq("id", userId)
					.maybeSingle();

				if (error && error.code !== "PGRST116") {
					console.error("Error fetching profile:", error);
					return null;
				}
				return data;
			} catch (error) {
				console.error("Profile catch error:", error);
				return null;
			}
		},
		[supabase]
	);

	const refreshProfile = useCallback(async () => {
		if (user) {
			const data = await fetchProfile(user.id);
			setProfile(data);
		}
	}, [user, fetchProfile]);

	// Initialize session from Better Auth
	useEffect(() => {
		const initialize = async () => {
			try {
				const { data: session } = await authClient.getSession();
				if (session?.user) {
					setUser(session.user as BetterAuthUser);
					const profileData = await fetchProfile(session.user.id);
					setProfile(profileData);
				}
			} catch (error) {
				console.error("Auth init error:", error);
			} finally {
				setLoading(false);
			}
		};

		// Only initialize if we don't have SSR data
		if (!initialUser) {
			initialize();
		} else {
			setLoading(false);
		}
	}, [fetchProfile, initialUser]);

	const signOut = async () => {
		setLoading(true);
		setUser(null);
		setProfile(null);
		try {
			// Use server action to log audit + invalidate session + redirect
			await signOutAction();
		} catch {
			// SignOutAction calls redirect() which throws in Next.js - expected
		}
		setLoading(false);
		router.refresh();
	};

	const isAdmin = ADMIN_ROLES.includes(profile?.role as (typeof ADMIN_ROLES)[number]);

	return (
		<AuthContext.Provider value={{ isAdmin, loading, profile, refreshProfile, signOut, user }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
