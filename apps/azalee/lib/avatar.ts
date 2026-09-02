/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hôtes d'avatars TIERS (OAuth) servis directement par leur CDN d'origine.
 * Ces images comptent dans le quota d'optimisation `_next/image` (→ 402 quand
 * il est épuisé : avatars cassés). On les rend en `unoptimized` pour bypasser
 * l'optimiseur Next — la taille d'un avatar (≤256 px) ne justifie pas l'optim.
 *
 * Les avatars hébergés chez nous (Supabase Storage `*.supabase.co`, `cdn`/
 * `azalee.rosegriffon.fr`) restent optimisés : ils sont sur notre origine.
 */
const REMOTE_AVATAR_HOSTS = [
	"cdn.discordapp.com",
	"lh3.googleusercontent.com",
	"pbs.twimg.com",
];

/**
 * Indique si une URL d'avatar provient d'un CDN tiers (Discord/Google/Twitter)
 * et doit donc être servie en `unoptimized` pour ne pas consommer le quota
 * d'optimisation d'images de Next (cf. piège 402 dans CLAUDE.md).
 */
export function isRemoteAvatar(url: string | null | undefined): boolean {
	if (!url) {
		return false;
	}
	return REMOTE_AVATAR_HOSTS.some((host) => url.includes(host));
}
