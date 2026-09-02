"use client";

import { useEffect } from "react";
import { useSidebar } from "@rosegriffon/ui";

/**
 * Ferme la sidebar desktop a l'arrivee sur une page article.
 * No-op sur mobile (la sidebar est un sheet superpose, pas pertinent).
 *
 * Pas de restore au unmount : si l'utilisateur reouvre la sidebar manuellement
 * ou navigue ailleurs, le cookie `sidebar:state` reprend le dessus.
 */
export function CollapseSidebarOnMount() {
	const { setOpen, isMobile } = useSidebar();
	useEffect(() => {
		if (isMobile) {
			return;
		}
		setOpen(false);
	}, [setOpen, isMobile]);
	return null;
}
