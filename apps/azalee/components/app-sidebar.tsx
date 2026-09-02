"use client";

import { ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useLanguage } from "@/components/providers/language-provider";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "@rosegriffon/ui";
import { dashboardItems, estItemActif, navigationItems } from "@/config/navigation";
import type { NavItem } from "@/config/navigation";
import type { GameIconKey } from "@/config/game-icons";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { iconMap } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useAuth } from "./providers/AuthProvider";
import { CommonSpriteIcon } from "./ui/CommonSpriteIcon";
import { GameSpriteIcon } from "./ui/GameSpriteIcon";

export function AppSidebar({ className, ...props }: React.ComponentProps<typeof Sidebar>) {
	const { isAdmin } = useAuth();
	const { state: _state } = useSidebar();
	const pathname = usePathname();
	const isDashboard = pathname.startsWith("/dashboard");
	const currentNavItems = isDashboard ? dashboardItems : navigationItems;
	const [mounted, setMounted] = React.useState(false);

	React.useEffect(() => {
		setMounted(true);
	}, []);

	// Les entrées réservées à l'administration dépendent d'une session lue côté
	// client : elles seules attendent le montage. Le reste du menu est rendu dès
	// le serveur — auparavant, un `mounted &&` gardait TOUTE la liste, si bien que
	// le HTML initial ne contenait aucun lien de navigation (rien à explorer pour
	// un robot, et une colonne vide le temps de l'hydratation).
	const filteredNavItems = currentNavItems.filter(
		(item) => !item.adminOnly || (mounted && isAdmin)
	);

	// Le spread arrivait APRÈS className : la classe passée par le Shell écrasait
	// celle du composant au lieu de la compléter, et la bordure droite par défaut
	// du composant partagé réapparaissait. On fusionne désormais les deux.
	return (
		<Sidebar
			collapsible="icon"
			variant="sidebar"
			className={cn("border-none bg-surface", className)}
			{...props}
		>
			<div className="absolute inset-0 bg-surface -z-10" />

			{/* NAVIGATION CONTENT */}
			<SidebarContent className="py-4 bg-surface">
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu className="gap-1">
							{filteredNavItems.map((item) => (
								<NavItemWithAnimation key={item.path} item={item} pathname={pathname} />
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarRail />
		</Sidebar>
	);
}

function NavItemWithAnimation({ item, pathname }: { item: NavItem; pathname: string }) {
	return (
		<div className="w-full">
			<RecursiveNavItem item={item} pathname={pathname} />
		</div>
	);
}

function NavIcon({
	item,
	isActive,
	isCollapsed,
	depth,
}: {
	item: NavItem;
	isActive: boolean;
	isCollapsed: boolean;
	depth: number;
}) {
	const { t } = useLanguage();
	const LucideIcon = iconMap[item.icon];

	if (item.imageUrl) {
		return (
			<div className="relative size-full">
				<Image
					src={item.imageUrl}
					alt={t(item.label)}
					fill
					className={cn(
						"object-contain",
						isActive
							? "opacity-100"
							: "opacity-70 grayscale group-hover:grayscale-0 group-hover:opacity-100"
					)}
				/>
			</div>
		);
	}

	if (item.gameIcon) {
		// Cellule native ~256x200 → on cible une hauteur d'icone ~20/24px.
		const px = isCollapsed && depth === 0 ? 24 : 20;
		return (
			<GameSpriteIcon
				name={item.gameIcon as GameIconKey}
				size={px}
				className={cn(isActive ? "opacity-100" : "opacity-70 group-hover:opacity-100")}
			/>
		);
	}

	if (item.commonSprite) {
		return (
			<CommonSpriteIcon
				name={item.commonSprite as SpriteCommonKey}
				scale={isCollapsed && depth === 0 ? 0.35 : 0.3}
				className={cn(
					isActive
						? "opacity-100"
						: "opacity-70 grayscale group-hover:grayscale-0 group-hover:opacity-100"
				)}
			/>
		);
	}

	if (LucideIcon) {
		return (
			<LucideIcon
				size={isCollapsed && depth === 0 ? 24 : 20}
				fill={isActive ? "currentColor" : "none"}
				aria-hidden="true"
			/>
		);
	}

	return null;
}

function RecursiveNavItem({
	item,
	pathname,
	depth = 0,
}: {
	item: NavItem;
	pathname: string;
	depth?: number;
}) {
	const { t } = useLanguage();
	const isActive = estItemActif(pathname, item);
	const [isOpen, setIsOpen] = React.useState(isActive || Boolean(item.defaultOpen));
	const { state, isMobile } = useSidebar();
	const isCollapsed = state === "collapsed" && !isMobile;

	const buttonClass = cn(
		"relative overflow-hidden w-full transition-all duration-200 group",
		"rounded-xl focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 outline-hidden",
		// En mode rail, la cva partagée impose `group-data-[collapsible=icon]:size-8!`
		// et `:p-2!`. tailwind-merge ne fusionne pas des classes de préfixes de
		// variante différents, et le `!` gagne en CSS : sans reprendre EXACTEMENT
		// le même préfixe, le bouton retombait à 32×32px dans un rail de 80px et
		// l'`overflow-hidden` rognait l'icône de 24px.
		isCollapsed && depth === 0
			? "h-[56px] flex-col justify-center px-1 gap-1 group-data-[collapsible=icon]:size-auto! group-data-[collapsible=icon]:h-14! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:p-1!"
			: "h-11 px-4 gap-3 justify-start",
		isActive
			? "bg-secondary-container text-on-secondary-container font-bold"
			: "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high active:bg-surface-container-highest"
	);

	const iconClass = cn(
		"flex items-center justify-center transition-transform duration-200",
		isCollapsed && depth === 0 ? "size-6" : "size-5",
		isActive && !item.imageUrl && !item.commonSprite && "scale-110",
		"group-hover:scale-110"
	);

	const itemContent = (
		<>
			<div className={iconClass}>
				<NavIcon item={item} isActive={Boolean(isActive)} isCollapsed={isCollapsed} depth={depth} />
			</div>

			{(!isCollapsed || depth > 0) && (
				<span
					className={cn(
						"whitespace-nowrap transition-all duration-300 font-medium truncate flex-1 text-sm",
						isActive ? "font-bold" : ""
					)}
				>
					{t(item.label)}
				</span>
			)}

			{item.children && (!isCollapsed || depth > 0) && (
				<ChevronRight
					size={18}
					className={cn(
						"ml-auto text-on-surface-variant/50 transition-transform duration-200",
						isOpen ? "rotate-90" : ""
					)}
					aria-hidden="true"
				/>
			)}
		</>
	);

	if (item.children && !isCollapsed) {
		return (
			<Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
				<SidebarMenuItem>
					{/* Un entête `groupOnly` n'a pas de route derrière lui : toute la
					    ligne devient le déclencheur du repli, au lieu d'un lien vers une
					    404 flanqué d'un second bouton chevron qui, lui, fonctionnait. */}
					{item.groupOnly ? (
						<CollapsibleTrigger asChild>
							<SidebarMenuButton
								isActive={isActive}
								tooltip={t(item.label)}
								className={cn(buttonClass, "w-full")}
								aria-expanded={isOpen}
							>
								<div className={iconClass}>
									<NavIcon
										item={item}
										isActive={Boolean(isActive)}
										isCollapsed={isCollapsed}
										depth={depth}
									/>
								</div>
								<span
									className={cn(
										"whitespace-nowrap transition-all duration-300 font-medium truncate flex-1 text-left text-sm",
										isActive ? "font-bold" : ""
									)}
								>
									{t(item.label)}
								</span>
								<ChevronRight
									size={18}
									className={cn(
										"shrink-0 text-on-surface-variant/50 transition-transform duration-200",
										isOpen ? "rotate-90" : ""
									)}
									aria-hidden="true"
								/>
							</SidebarMenuButton>
						</CollapsibleTrigger>
					) : (
						<div className="flex items-center w-full">
							<SidebarMenuButton
								asChild
								isActive={isActive}
								tooltip={t(item.label)}
								className={cn(buttonClass, "flex-1 min-w-0 !pr-0")}
							>
								<Link href={item.path} aria-current={isActive ? "page" : undefined}>
									<div className={iconClass}>
										<NavIcon
											item={item}
											isActive={Boolean(isActive)}
											isCollapsed={isCollapsed}
											depth={depth}
										/>
									</div>
									<span
										className={cn(
											"whitespace-nowrap transition-all duration-300 font-medium truncate flex-1 text-sm",
											isActive ? "font-bold" : ""
										)}
									>
										{t(item.label)}
									</span>
								</Link>
							</SidebarMenuButton>
							<CollapsibleTrigger asChild>
								<button className="size-9 flex items-center justify-center rounded-lg text-on-surface-variant/50 hover:text-on-surface-variant hover:bg-on-surface/[0.08] transition-colors shrink-0">
									<ChevronRight
										size={18}
										className={cn("transition-transform duration-200", isOpen ? "rotate-90" : "")}
										aria-hidden="true"
									/>
								</button>
							</CollapsibleTrigger>
						</div>
					)}
					<CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
						<SidebarMenu className="mt-1 ml-4 border-l-2 border-outline-variant/20 pl-2 space-y-1">
							{item.children.map((child) => (
								<RecursiveNavItem
									key={child.path}
									item={child}
									pathname={pathname}
									depth={depth + 1}
								/>
							))}
						</SidebarMenu>
					</CollapsibleContent>
				</SidebarMenuItem>
			</Collapsible>
		);
	}

	// Sidebar repliée : le branchement `Collapsible` ci-dessus est court-circuité.
	// Un entête de groupe redeviendrait alors un lien vers une route inexistante,
	// et ses enfants seraient inatteignables — on renvoie vers le premier enfant.
	const href = item.groupOnly ? (item.children?.[0]?.path ?? item.path) : item.path;

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				asChild
				isActive={isActive}
				tooltip={t(item.label)}
				className={buttonClass}
			>
				<Link href={href} aria-current={isActive ? "page" : undefined}>
					{itemContent}
				</Link>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
