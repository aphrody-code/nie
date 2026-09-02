import type { AccountTabId } from "./types";

/**
 * Helpers d'onglets, volontairement hors du module `account-shell.tsx`.
 *
 * Celui-ci porte `"use client"`, et une fonction exportée par un module client ne
 * peut pas être appelée depuis un Server Component : Next répond « Attempted to
 * call resolveAccountTab() from the server but resolveAccountTab is on the
 * client ». Or les deux pages compte sont des Server Components qui valident le
 * `?tab=` avant de rendre la coquille.
 */

/** Onglets connus, dans leur ordre canonique. */
export const ACCOUNT_TAB_IDS = ["profile", "address", "connections", "security"] as const;

/** Normalise un `?tab=` arbitraire vers un onglet réellement monté. */
export function resolveAccountTab(
	raw: string | undefined,
	available: readonly AccountTabId[]
): AccountTabId {
	return available.includes(raw as AccountTabId) ? (raw as AccountTabId) : (available[0] ?? "profile");
}
