/**
 * Types User/Profile partagés — réexporte la source unique depuis @rosegriffon/db
 * (Database types générés par Supabase CLI). Évite la duplication
 * `type Profile = Database["public"]["Tables"]["profiles"]["Row"]` qui était
 * répétée dans 9+ fichiers website.
 */
import type { Database } from "@rosegriffon/db";
import type { RgRole } from "./roles";

/** Profile Supabase canonique (row de la table public.profiles). */
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** Alias historique — `User` est synonyme de `Profile`. */
export type User = Profile;

/** Profile avec role typé (au lieu de `string | null`). */
export type ProfileWithRole = Omit<Profile, "role"> & {
	role: RgRole | null;
};

/** Insert payload pour création (timestamps + id optionnels). */
export type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];

/** Update payload partiel. */
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

/** Membre Discord synchronisé en DB. */
export type DiscordMember = Database["public"]["Tables"]["discord_members"]["Row"];
