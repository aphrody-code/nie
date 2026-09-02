"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Shield, Home } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "../lib/utils";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "./drawer";

export interface NavItem {
	title: string;
	href: string;
	icon: LucideIcon;
	exact?: boolean;
	badge?: string;
	creatorOnly?: boolean;
	submenu?: { title: string; href: string }[];
}

interface AdminSidebarProps {
	items: NavItem[];
	baseHref?: string;
	logo?: React.ReactNode;
	title?: string;
	subtitle?: string;
	footer?: React.ReactNode;
	showCreatorItems?: boolean;
}

/**
 * Shared Admin Sidebar component.
 * Highly configurable for different apps.
 */
export function AdminSidebar({
	items,
	logo,
	title = "Gestion",
	subtitle = "Rose Griffon",
	footer,
	showCreatorItems = false,
	// Le prop était déclaré dans l'interface mais jamais lu : les trois ancres de
	// retour étaient figées sur "/admin", ce qui interdisait à azalee (dont
	// l'espace d'administration vit sous /dashboard) d'adopter ce composant.
	baseHref = "/admin",
}: AdminSidebarProps) {
	const pathname = usePathname();
	const [openSubmenu, setOpenSubmenu] = React.useState<string | null>(null);
	const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);

	const navItems = items.filter((item) => !item.creatorOnly || showCreatorItems);

	const toggleSubmenu = (title: string) => {
		setOpenSubmenu(openSubmenu === title ? null : title);
	};

	const isActive = (href: string, exact?: boolean) =>
		exact ? pathname === href : (pathname || "").startsWith(href);

	const NavContent = ({ mobile = false }: { mobile?: boolean }) => (
		<nav className={cn("flex-1 space-y-1 overflow-y-auto p-3", mobile && "px-0")}>
			{navItems.map((item) => {
				const Icon = item.icon;
				const active = isActive(item.href, item.exact);
				const hasSubmenu = item.submenu && item.submenu.length > 0;
				const submenuOpen = openSubmenu === item.title;

				return (
					<div key={item.href}>
						{hasSubmenu ? (
							<button
								onClick={() => toggleSubmenu(item.title)}
								className={cn(
									"flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
									active
										? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
										: "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
								)}
							>
								<div className="flex items-center gap-3">
									<Icon className="size-4 shrink-0" />
									<span>{item.title}</span>
								</div>
								<ChevronDown
									className={cn("h-3.5 w-3.5 transition-transform", submenuOpen && "rotate-180")}
								/>
							</button>
						) : (
							<Link
								href={item.href}
								onClick={() => mobile && setIsDrawerOpen(false)}
								className={cn(
									"group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
									active
										? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
										: "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
								)}
							>
								<Icon className="size-4 shrink-0" />
								<span className="flex-1 truncate">{item.title}</span>
								{item.badge && (
									<span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-primary">
										{item.badge}
									</span>
								)}
							</Link>
						)}

						{hasSubmenu && submenuOpen && (
							<div className="ml-3 mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
								{item.submenu?.map((subitem) => (
									<Link
										key={subitem.href}
										href={subitem.href}
										onClick={() => mobile && setIsDrawerOpen(false)}
										className={cn(
											"block rounded-md px-3 py-2 text-sm transition-colors",
											pathname === subitem.href
												? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
												: "text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
										)}
									>
										{subitem.title}
									</Link>
								))}
							</div>
						)}
					</div>
				);
			})}
		</nav>
	);

	return (
		<>
			{/* Mobile Header */}
			<div className="fixed top-0 left-0 right-0 z-30 flex h-16 items-center justify-between border-b border-sidebar-border bg-sidebar px-4 shadow-sm lg:hidden">
				<Link href={baseHref} className="flex items-center gap-2">
					<div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-foreground/15">
						<Shield className="size-4 text-sidebar-foreground" />
					</div>
					<span className="font-bold text-sidebar-foreground">Admin</span>
				</Link>
			</div>

			{/* Desktop Sidebar */}
			<aside className="sticky top-0 hidden h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
				<div className="border-b border-sidebar-border p-4">
					<Link href={baseHref} className="flex items-center gap-3">
						{logo || (
							<div className="flex size-9 items-center justify-center rounded-lg bg-sidebar-foreground/15">
								<Shield className="size-4 text-sidebar-foreground" />
							</div>
						)}
						<div className="min-w-0">
							<h2 className="truncate font-semibold text-sidebar-foreground">{title}</h2>
							<p className="truncate text-xs text-sidebar-foreground/80">{subtitle}</p>
						</div>
					</Link>
				</div>

				<NavContent />

				{footer && <div className="border-t border-sidebar-border p-3">{footer}</div>}
			</aside>

			{/* Mobile Bottom Navigation (optional, app can use its own) */}
			<div className="pb-safe fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-sidebar-border bg-sidebar px-4 py-2 lg:hidden">
				<Link
					href={baseHref}
					className={cn(
						"flex flex-col items-center gap-1 rounded-lg p-2 transition-colors",
						pathname === baseHref ? "text-sidebar-foreground" : "text-sidebar-foreground/80"
					)}
				>
					<Home className="size-5" />
					<span className="text-[11px] font-medium leading-none">Accueil</span>
				</Link>
				{/* The app can provide more items or we can auto-pick the first 2-3 items from 'items' prop */}

				<Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
					<DrawerTrigger asChild>
						<button className="flex flex-col items-center gap-1 rounded-lg p-2 text-sidebar-foreground/80 transition-colors hover:text-sidebar-foreground">
							<Menu className="size-5" />
							<span className="text-[11px] font-medium leading-none">Menu</span>
						</button>
					</DrawerTrigger>
					<DrawerContent className="max-h-[80vh]">
						<DrawerHeader>
							<DrawerTitle>Menu Navigation</DrawerTitle>
							<DrawerDescription>Accès rapide aux modules</DrawerDescription>
						</DrawerHeader>
						<div className="overflow-y-auto px-4 pb-8">
							<NavContent mobile={true} />
							{footer && <div className="mt-2 border-t border-border p-3">{footer}</div>}
						</div>
					</DrawerContent>
				</Drawer>
			</div>
		</>
	);
}
