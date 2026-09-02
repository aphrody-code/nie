"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GameSpriteIcon } from "@/components/ui/GameSpriteIcon";
import type { GameIconKey } from "@/config/game-icons";
import { useLanguage } from "@/components/providers/language-provider";
import { dashboardItems, estItemActif, navigationItems } from "@/config/navigation";
import { iconMap } from "@/lib/icons";
import { NavigationRail, NavigationRailItem } from "@rosegriffon/ui";
import { useAuth } from "@/components/providers/AuthProvider";

export function AzaleeNavigationRail() {
	const pathname = usePathname();
	const { t } = useLanguage();
	const { isAdmin } = useAuth();
	const isDashboard = pathname.startsWith("/dashboard");
	const currentNavItems = isDashboard ? dashboardItems : navigationItems;

	const filteredNavItems = currentNavItems.filter((item) => {
		if (item.adminOnly) {
			return isAdmin;
		}
		return true;
	});

	// Visibilité pilotée par le Shell, qui ne monte le rail qu'au breakpoint
	// « medium » (600–839px). Les classes `hidden md:flex lg:hidden` posées ici en
	// plus le masquaient de 600 à 767px, plage où ni la sidebar ni la barre basse
	// ne sont montées : plus aucune navigation possible.
	return (
		<NavigationRail
			aria-label="Navigation principale"
			className="fixed left-0 top-14 bottom-0 z-50 flex overflow-y-auto border-r border-outline-variant/10"
		>
			{filteredNavItems.map((item) => {
				const LucideIcon = iconMap[item.icon];
				const isActive = estItemActif(pathname, item);
				// Un entête de groupe n'a pas de route : le rail pointait dessus et
				// tombait en 404 (les quatre groupes du tableau de bord). On renvoie
				// vers son premier enfant, comme le fait la colonne repliée.
				const href = item.groupOnly ? (item.children?.[0]?.path ?? item.path) : item.path;

				// Priorite : vraie icone du jeu (teintee) > lucide.
				const icon = item.gameIcon ? (
					<GameSpriteIcon name={item.gameIcon as GameIconKey} size={24} />
				) : LucideIcon ? (
					<LucideIcon size={24} />
				) : null;

				return (
					<Link key={item.path} href={href} passHref legacyBehavior>
						<NavigationRailItem active={isActive} icon={icon} label={t(item.label)} />
					</Link>
				);
			})}
		</NavigationRail>
	);
}
