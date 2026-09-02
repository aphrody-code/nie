"use client";

import { AdminSidebar, type NavItem } from "@rosegriffon/ui";
import {
	Database,
	FileSpreadsheet,
	FileText,
	Home,
	LayoutDashboard,
	Newspaper,
	Settings,
	ShieldCheck,
	Tag,
	Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

/**
 * Barre latérale de l'espace d'administration du wiki.
 *
 * Elle utilise le composant partagé `AdminSidebar` — le même que
 * `/admin` du site principal — pour que les deux tableaux de bord se
 * ressemblent et se corrigent d'un seul endroit. `baseHref` pointe sur
 * `/dashboard` : l'espace d'administration du wiki ne vit pas sous `/admin`.
 *
 * Auparavant le dashboard n'avait pas de barre propre : la barre principale du
 * site permutait simplement ses entrées, toutes marquées `adminOnly`. Elles
 * étaient filtrées par le `isAdmin` du contexte client, si bien qu'au moindre
 * échec de résolution du profil la barre se vidait entièrement — l'espace
 * d'administration se retrouvait sans navigation. Ici, l'autorisation est
 * vérifiée côté serveur dans le layout, donc la barre est toujours rendue.
 */
const ITEMS: NavItem[] = [
	{ href: "/dashboard", icon: LayoutDashboard, title: "Vue d'ensemble", exact: true },
	{
		href: "/dashboard/news",
		icon: Newspaper,
		title: "Actualités",
		submenu: [
			{ href: "/dashboard/news", title: "Toutes les actualités" },
			{ href: "/dashboard/news/new", title: "Nouvelle actualité" },
			{ href: "/dashboard/news/stats", title: "Statistiques" },
		],
	},
	{
		href: "/dashboard/database",
		icon: Database,
		title: "Base de données",
		submenu: [
			{ href: "/dashboard/database", title: "Tables" },
			{ href: "/dashboard/database/images", title: "Images" },
			{ href: "/dashboard/database/verification", title: "Vérification" },
		],
	},
	{ href: "/dashboard/tweets", icon: Tag, title: "Tweets" },
	{ href: "/dashboard/zukan-review", icon: FileText, title: "Revue zukan" },
	{
		href: "/dashboard/import-google-doc",
		icon: FileSpreadsheet,
		title: "Imports",
		submenu: [
			{ href: "/dashboard/import-google-doc", title: "Document Google" },
			{ href: "/dashboard/import-sheet", title: "Feuille de calcul" },
		],
	},
	{ href: "/dashboard/audit", icon: ShieldCheck, title: "Journal d'audit" },
	{ href: "/dashboard/users", icon: Users, title: "Utilisateurs" },
	{ href: "/dashboard/settings", icon: Settings, title: "Paramètres" },
];

export function DashboardSidebar() {
	return (
		<AdminSidebar
			items={ITEMS}
			baseHref="/dashboard"
			title="Administration"
			subtitle="Azalée"
			logo={
				<Image src="/logo.webp" alt="" width={28} height={28} className="object-contain" />
			}
			footer={
				// `Link` et non `<a>` : la navigation interne restait un rechargement
				// complet du document (perte du cache routeur et du prefetch).
				<Link
					href="/"
					className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
				>
					<Home className="size-4 shrink-0" aria-hidden />
					Retour au wiki
				</Link>
			}
		/>
	);
}
