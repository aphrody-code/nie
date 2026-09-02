/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AuthorInfo {
	name: string;
	avatar: string | null;
	initials: string;
	bio: string;
	color: string;
}

export function getAuthorInfo(
	username: string | null | undefined,
	authorName: string | null | undefined
): AuthorInfo {
	const user = username || "";
	const name = authorName || user;

	switch (user.toLowerCase()) {
		case "azalee_ie":
			return {
				name: "Azalée 🌸",
				avatar: "/icon.webp",
				initials: "AZ",
				bio: "Actualités, wiki et traductions sur Inazuma Eleven: Victory Road en français.",
				color: "bg-[#1DA1F2]",
			};
		case "akihirohino":
			return {
				name: name || "Akihiro Hino",
				avatar: null,
				initials: "AH",
				bio: "Directeur Général de Level-5. Créateur d'Inazuma Eleven.",
				color: "bg-red-500",
			};
		case "level5_times":
			return {
				name: name || "LEVEL5_times",
				avatar: null,
				initials: "L5",
				bio: "Compte officiel pour les actualités de LEVEL-5.",
				color: "bg-amber-500",
			};
		case "inazuma_project":
			return {
				name: name || "Inazuma Project",
				avatar: null,
				initials: "IP",
				bio: "Compte officiel du projet Inazuma Eleven.",
				color: "bg-blue-600",
			};
		default:
			return {
				name: name || user || "Twitter",
				avatar: null,
				initials: user ? user.slice(0, 2).toUpperCase() : "TX",
				bio: "Actualités partagées via Twitter.",
				color: "bg-slate-600",
			};
	}
}
