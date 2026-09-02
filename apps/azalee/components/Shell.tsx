"use client";

import { Check, CircleUser, Download, LayoutDashboard, Menu, Moon, User, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { SkipToContent } from "@/components/accessibility/SkipToContent";
import { AppSidebar } from "@/components/app-sidebar";
import { LoginDialog } from "@/components/auth/login-dialog";
import { Footer } from "@/components/layout/Footer";
import { MaterialBottomNav } from "@/components/navigation/MaterialBottomNav";
import { NotificationBell } from "@/components/news/NotificationBell";
import { AuthProvider, useAuth } from "@/components/providers/AuthProvider";
import { useLanguage } from "@/components/providers/language-provider";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	SidebarInset,
	SidebarProvider,
	useBreakpoint,
	useSidebar,
} from "@rosegriffon/ui";
import { AzaleeNavigationRail } from "@/components/navigation/AzaleeNavigationRail";
import { GlobalSearch } from "@/components/wiki/GlobalSearch";
import { isRemoteAvatar } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import type { AzaleeProfile, BetterAuthUser } from "./providers/AuthProvider";

/**
 * MOBILE AVATAR — avec fallback si l'image est cassée
 */
function MobileAvatar({
	profile,
	onClick,
}: {
	profile: AzaleeProfile | null;
	onClick: () => void;
}) {
	const [imgError, setImgError] = useState(false);
	const showImg = profile?.avatar_url && !imgError;

	return (
		<button
			className="size-12 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0 active:scale-95 transition-transform"
			onClick={onClick}
			aria-label="Mon compte"
		>
			{showImg ? (
				<Image
					src={profile!.avatar_url!}
					alt=""
					width={48}
					height={48}
					className="w-full h-full object-cover"
					onError={() => setImgError(true)}
					unoptimized={isRemoteAvatar(profile!.avatar_url)}
				/>
			) : (
				<User size={24} className="text-primary" aria-hidden="true" />
			)}
		</button>
	);
}

/**
 * MOBILE HEADER - MD3 Top App Bar (Small)
 */
function MobileHeader({ isHome }: { isHome: boolean }) {
	const router = useRouter();
	const { toggleSidebar, openMobile } = useSidebar();
	const { t } = useLanguage();
	const { user, profile, isAdmin } = useAuth();
	const [isScrolled, setIsScrolled] = useState(false);
	const pathname = usePathname();

	useEffect(() => {
		const handleScroll = () => setIsScrolled(window.scrollY > 0);
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	const getTitle = () => {
		if (pathname === "/") {
			return "";
		}
		if (pathname === "/wiki") {
			return "header.wiki";
		}
		if (pathname.startsWith("/search")) {
			return "header.wiki";
		}
		if (pathname.startsWith("/news")) {
			return "header.news";
		}
		if (pathname.startsWith("/patch-notes")) {
			return "header.patch_notes";
		}
		if (pathname.startsWith("/chara")) {
			return "header.players";
		}
		if (pathname.startsWith("/skill")) {
			return "header.skills";
		}
		if (pathname.startsWith("/item")) {
			return "header.items";
		}
		if (pathname.startsWith("/aura")) {
			return "header.hyper_skills";
		}
		if (pathname.startsWith("/passive")) {
			return "header.passives";
		}
		if (pathname.startsWith("/tactic")) {
			return "header.tactics";
		}
		if (pathname.startsWith("/team")) {
			return "header.teams";
		}
		if (pathname.startsWith("/tools")) {
			return "header.tools";
		}
		if (pathname.startsWith("/settings")) {
			return "header.settings";
		}
		return "";
	};

	const title = getTitle();

	return (
		<header
			className={cn(
				"fixed top-0 left-0 right-0 z-40 flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-2 px-4 pt-safe md:hidden",
				"transition-[background-color,box-shadow] duration-300 motion-standard",
				isScrolled ? "bg-surface-container/90 backdrop-blur-xl elevation-1" : "bg-surface"
			)}
		>
			<button
				onClick={toggleSidebar}
				className="size-12 flex items-center justify-center text-on-surface hover:bg-on-surface/[0.08] rounded-full transition-colors -ml-1"
				aria-label="Ouvrir le menu"
				aria-expanded={openMobile}
			>
				<Menu size={24} aria-hidden="true" />
			</button>

			{isHome || !title ? (
				<Link href="/" className="flex items-center gap-1.5 shrink-0 ml-1">
					<div className="relative size-7">
						<Image src="/logo.webp" fill sizes="28px" alt="Azalée" className="object-contain" />
					</div>
					<span className="type-title-large text-on-surface">Azalée</span>
				</Link>
			) : (
				<span className="type-title-large text-on-surface truncate ml-1">{t(title)}</span>
			)}

			<div className="flex-1" />
			<div className="flex items-center gap-0.5">
				{isAdmin && (
					<Link
						href="/dashboard"
						className="size-12 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-on-surface/[0.08] active:bg-on-surface/[0.12] transition-colors"
						aria-label="Administration"
					>
						<LayoutDashboard size={24} aria-hidden="true" />
					</Link>
				)}
				<NotificationBell className="size-12" />
				<ThemeToggle className="size-12" />

				<div className="ml-1">
					{user ? (
						<MobileAvatar profile={profile} onClick={() => router.push("/settings")} />
					) : (
						<LoginDialog>
							<button
								className="size-12 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-on-surface/[0.08] active:bg-on-surface/[0.12] transition-colors"
								aria-label="Se connecter"
							>
								<CircleUser size={24} aria-hidden="true" />
							</button>
						</LoginDialog>
					)}
				</div>
			</div>
		</header>
	);
}

/**
 * THEME TOGGLE
 *
 * `light`/`dark` = palette Azalée (globals.css `:root` / `:root.dark`).
 * `roy`/`gaelle` = thèmes Rose Griffon partagés, fournis par
 * `@rosegriffon/ui/styles.css` et retraduits en triplets HSL dans
 * `app/globals.css` (contrat de tokens propre à azalee).
 */
const AZALEE_THEMES: {
	id: string;
	label: string;
	icon?: typeof Moon;
	image?: string;
}[] = [
	{ id: "dark", label: "Azalée", image: "/emote/RG_Reika_zukan.webp" },
	{ id: "roy", label: "Roy", image: "/emote/RG_Roy_salut.webp" },
	{ id: "gaelle", label: "Gaëlle", image: "/emote/RG_Gaelle_salut.webp" },
];

function ThemeToggle({ className }: { className?: string }) {
	const { setTheme, theme } = useTheme();
	const { t } = useLanguage();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		// eslint-disable-next-line
		setMounted(true);
	}, []);

	if (!mounted) {
		return (
			<div
				className={cn(
					"size-12 md:size-10 rounded-full flex items-center justify-center text-on-surface-variant/20",
					className
				)}
			>
				<Moon className="size-6 md:size-5" aria-hidden="true" />
			</div>
		);
	}

	const active = AZALEE_THEMES.find((entry) => entry.id === theme) ?? AZALEE_THEMES[0]!;
	const ActiveIcon = active.icon;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className={cn(
						"relative size-12 md:size-10 rounded-full flex items-center justify-center text-on-surface-variant",
						"hover:bg-on-surface/[0.08] active:bg-on-surface/[0.12] transition-all duration-300",
						className
					)}
					aria-label={t("theme.toggle_light")}
					title={active.label}
				>
					{ActiveIcon ? (
						<ActiveIcon className="size-6 md:size-5" aria-hidden="true" />
					) : (
						<Image
							src={active.image!}
							alt=""
							width={24}
							height={24}
							unoptimized
							className="size-6 md:size-5 object-contain"
						/>
					)}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48">
				{AZALEE_THEMES.map((entry) => {
					const Icon = entry.icon;
					return (
						<DropdownMenuItem
							key={entry.id}
							onClick={() => setTheme(entry.id)}
							className="gap-2.5"
							aria-current={entry.id === active.id ? "true" : undefined}
						>
							{Icon ? (
								<Icon className="size-4 shrink-0" aria-hidden="true" />
							) : (
								<Image
									src={entry.image!}
									alt=""
									width={20}
									height={20}
									unoptimized
									className="size-5 shrink-0 object-contain"
								/>
							)}
							<span className="flex-1 truncate">{entry.label}</span>
							{entry.id === active.id && (
								<Check className="size-4 shrink-0 opacity-70" aria-hidden="true" />
							)}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * DESKTOP AVATAR — avec fallback si l'image est cassée
 */
function DesktopAvatar({
	profile,
	onClick,
	label,
}: {
	profile: AzaleeProfile | null;
	onClick: () => void;
	label: string;
}) {
	const [imgError, setImgError] = useState(false);
	const showImg = profile?.avatar_url && !imgError;

	return (
		<div
			className="size-9 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden transition-all duration-200 cursor-pointer hover:ring-2 hover:ring-primary/20 active:scale-95"
			onClick={onClick}
			role="button"
			tabIndex={0}
			aria-label={label}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					onClick();
				}
			}}
		>
			{showImg ? (
				<Image
					src={profile!.avatar_url!}
					alt=""
					width={36}
					height={36}
					className="w-full h-full object-cover"
					onError={() => setImgError(true)}
					unoptimized={isRemoteAvatar(profile!.avatar_url)}
				/>
			) : (
				<User size={18} className="text-primary" aria-hidden="true" />
			)}
		</div>
	);
}

/**
 * DESKTOP TOP BAR - YouTube Style
 */
function DesktopTopBar() {
	const pathname = usePathname();
	const router = useRouter();
	const { user, profile, isAdmin } = useAuth();
	const { t } = useLanguage();
	const { toggleSidebar, open } = useSidebar();
	const isHome = pathname === "/";

	const getTitle = () => {
		if (pathname === "/") {
			return "";
		}
		if (pathname.startsWith("/news")) {
			return "Actualités";
		}
		if (pathname.startsWith("/patch-notes")) {
			return "Patch Notes";
		}
		if (pathname.startsWith("/chara")) {
			return "Joueurs";
		}
		if (pathname.startsWith("/skill")) {
			return "Techniques";
		}
		if (pathname.startsWith("/item")) {
			return "Objets";
		}
		if (pathname.startsWith("/aura")) {
			return "Hyper Techniques";
		}
		if (pathname.startsWith("/passive")) {
			return "Passifs";
		}
		if (pathname.startsWith("/tactic")) {
			return "Tactiques";
		}
		if (pathname.startsWith("/wiki")) {
			return "Encyclopédie";
		}
		if (pathname.startsWith("/search")) {
			return "Encyclopédie";
		}
		if (pathname.startsWith("/tools")) {
			return "Outils";
		}
		return "";
	};

	const title = getTitle();

	return (
		// `hidden md:flex` en plus du montage `!isCompact` laissait 600–767px sans
		// aucune barre : le CSS masquait ce que React avait monté.
		<header className="fixed top-0 left-0 right-0 z-[60] flex h-14 items-center justify-between px-4 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/5">
			{/* Left: Burger + Logo + (Optional) Title */}
			<div className="flex items-center gap-1 min-w-[200px]">
				<button
					onClick={toggleSidebar}
					className="size-10 rounded-full flex items-center justify-center text-on-surface hover:bg-on-surface/[0.08] active:bg-on-surface/[0.12] transition-colors"
					aria-label="Ouvrir le menu"
					aria-expanded={open}
				>
					<Menu size={24} aria-hidden="true" />
				</button>
				<Link href="/" className="flex items-center gap-2 group px-3">
					<div className="relative size-7 shrink-0 transition-transform group-hover:scale-105">
						<Image src="/logo.webp" fill sizes="28px" alt="Azalée" className="object-contain" />
					</div>
					<span className="font-expressive-title text-xl text-on-surface transition-all duration-500 group-hover:text-primary group-hover:font-width-expanded">
						Azalée
					</span>
				</Link>

				{title && (
					<div className="flex items-center gap-2 ml-2 animate-in fade-in slide-in-from-left-2 duration-300">
						<span className="size-1 rounded-full bg-outline-variant/40" />
						<span className="font-bold text-sm text-on-surface-variant tracking-wide opacity-80 mt-0.5">
							{title}
						</span>
					</div>
				)}
			</div>

			{/* Center: Search Bar */}
			<div className="flex items-center justify-center flex-1 max-w-[600px] px-8">
				{!isHome && (
					<div className="w-full flex items-center bg-surface-container-high/60 rounded-full px-4 h-10 focus-within:bg-surface-container-highest focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-200">
						<GlobalSearch isCompact />
					</div>
				)}
			</div>

			{/* Right: Actions */}
			<div className="flex items-center justify-end gap-1 min-w-[200px]">
				{isAdmin && (
					<Link
						href="/dashboard"
						className="size-10 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-on-surface/[0.08] active:bg-on-surface/[0.12] transition-colors"
						aria-label="Administration"
						title="Administration"
					>
						<LayoutDashboard size={20} aria-hidden="true" />
					</Link>
				)}
				<NotificationBell />
				<ThemeToggle />

				<div className="ml-2">
					{user ? (
						<DesktopAvatar
							profile={profile}
							onClick={() => router.push("/settings")}
							label={profile?.username || t("auth.account")}
						/>
					) : (
						<LoginDialog>
							<button className="h-9 px-4 rounded-full flex items-center gap-2 text-primary type-label-large hover:bg-primary/8 active:bg-primary/12 transition-colors duration-200">
								<CircleUser size={20} aria-hidden="true" />
								{t("auth.login")}
							</button>
						</LoginDialog>
					)}
				</div>
			</div>
		</header>
	);
}

/**
 * PWA INSTALL BANNER
 */
function InstallBanner({ onDismiss, onInstall }: { onDismiss: () => void; onInstall: () => void }) {
	return (
		<div className="fixed bottom-24 left-4 right-4 z-[60] md:left-auto md:right-6 md:bottom-6 md:w-80 animate-in slide-in-from-bottom-4 duration-300">
			<div className="flex items-center gap-3 p-4 rounded-2xl bg-primary-container text-on-primary-container shadow-level-3">
				<Download size={24} className="shrink-0" aria-hidden="true" />
				<div className="flex-1 min-w-0">
					<p className="type-title-small">Installer Azalee</p>
					<p className="type-body-small opacity-80">
						Accès rapide depuis l&apos;écran d&apos;accueil
					</p>
				</div>
				<button
					onClick={onInstall}
					className="px-4 py-2 rounded-full bg-primary text-on-primary type-label-large shrink-0"
				>
					Installer
				</button>
				<button
					onClick={onDismiss}
					className="size-8 rounded-full flex items-center justify-center hover:bg-on-primary-container/10"
					aria-label="Fermer"
				>
					<X size={18} aria-hidden="true" />
				</button>
			</div>
		</div>
	);
}

/**
 * MAIN SHELL COMPONENT
 */

export function Shell({
	children,
	user,
	profile,
	defaultOpen = true,
}: {
	children: React.ReactNode;
	user: BetterAuthUser | null;
	profile: AzaleeProfile | null;
	defaultOpen?: boolean;
}) {
	const pathname = usePathname();
	const breakpoint = useBreakpoint();

	const isCompact = breakpoint === "compact";
	const isMedium = breakpoint === "medium";
	const isExpanded = breakpoint === "expanded" || breakpoint === "large";

	const isEditorPage =
		pathname.startsWith("/dashboard/news/") &&
		(pathname.includes("/new") || pathname.split("/").length > 3);
	const isFullscreenPage = pathname === "/login";
	// L'espace d'administration a sa PROPRE barre latérale (le composant partagé
	// `AdminSidebar`, monté par `app/dashboard/layout.tsx`, comme `/admin` côté
	// site principal). Afficher en plus la barre du wiki en donnerait deux côte à
	// côte et écraserait le contenu.
	const isDashboard = pathname.startsWith("/dashboard");

	// Service Worker registration
	useEffect(() => {
		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.register("/sw.js").catch(() => {});
		}
	}, []);

	// PWA install prompt
	const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
	const [showInstall, setShowInstall] = useState(false);

	useEffect(() => {
		const handler = (e: Event) => {
			e.preventDefault();
			deferredPromptRef.current = e as BeforeInstallPromptEvent;
			// Only show if not dismissed before
			if (!sessionStorage.getItem("pwa-install-dismissed")) {
				setShowInstall(true);
			}
		};
		window.addEventListener("beforeinstallprompt", handler);
		return () => window.removeEventListener("beforeinstallprompt", handler);
	}, []);

	const handleInstall = useCallback(async () => {
		const prompt = deferredPromptRef.current;
		if (!prompt) {
			return;
		}
		prompt.prompt();
		await prompt.userChoice;
		deferredPromptRef.current = null;
		setShowInstall(false);
	}, []);

	const handleDismissInstall = useCallback(() => {
		setShowInstall(false);
		sessionStorage.setItem("pwa-install-dismissed", "1");
	}, []);

	if (isEditorPage || isFullscreenPage) {
		return (
			<AuthProvider initialUser={user} initialProfile={profile}>
				<div className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-background pb-[env(safe-area-inset-bottom)]">{children}</div>
			</AuthProvider>
		);
	}

	return (
		<AuthProvider initialUser={user} initialProfile={profile}>
			<SidebarProvider defaultOpen={defaultOpen}>
				{/* Accessibilité: lien pour sauter au contenu principal */}
				<SkipToContent />

				{/* Fixed Header - Standard Layout (Visible on Medium/Expanded) */}
				{!isCompact && <DesktopTopBar />}

				{/* Main Layout - Adaptive based on screen size */}
				<div className={cn("flex w-full bg-surface min-h-[100dvh]", !isCompact && "pt-14")}>
					{/* NAVIGATION RAIL (MEDIUM SCREENS) */}
					{isMedium && !isDashboard && <AzaleeNavigationRail />}

					{/* SIDEBAR (EXPANDED OR COMPACT SCREENS) */}
					{(isExpanded || isCompact) && !isDashboard && (
						<AppSidebar
							variant="sidebar"
							// `inset-y-0` + une hauteur explicite sur-contraint la boîte : le
							// navigateur lâche `bottom` et la sidebar repart de y=0, sous la top
							// bar (z-60) qui avale son premier item. On la décale, on ne la rogne pas.
							className={cn(isExpanded && "top-14! h-auto!")}
						/>
					)}

					{/* Content Area */}
					<SidebarInset
						className={cn(
							"flex-1 min-w-0 bg-surface-container flex flex-col transition-all duration-300",
							isMedium && !isDashboard && "ml-20" // Décalage du rail, actif dès 600px comme lui
						)}
					>
						{/* Mobile Header (Only visible on Compact) */}
						{isCompact && !isDashboard && <MobileHeader isHome={pathname === "/"} />}

						<main
							id="main-content"
							className={cn(
								"flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide flex flex-col",
								isCompact && !isDashboard ? "pt-[calc(4rem+env(safe-area-inset-top))]" : "pt-0"
							)}
						>
							<PullToRefresh>
								{/* La réserve du bas ne vaut que si la barre de navigation basse est
								    réellement montée (compact) : `md:pb-6` coupait à 768px alors
								    que la barre disparaît dès 600px. */}
								<div
									className={cn(
										"vt-page-content mx-auto w-full max-w-[1800px] flex-1 px-4 md:px-8 lg:px-12",
										isCompact && !isDashboard
											? "pb-[calc(6rem+env(safe-area-inset-bottom))]"
											: "pb-6"
									)}
								>
									{children}
								</div>
							</PullToRefresh>
							<Footer />
						</main>
					</SidebarInset>
				</div>

				{/* BOTTOM NAV (COMPACT SCREENS) — hors administration, qui a la sienne */}
				{isCompact && !isDashboard && (
					<div className="fixed bottom-0 left-0 right-0 z-50">
						<MaterialBottomNav />
					</div>
				)}

				{showInstall && (
					<InstallBanner onDismiss={handleDismissInstall} onInstall={handleInstall} />
				)}
			</SidebarProvider>
		</AuthProvider>
	);
}

// BeforeInstallPromptEvent type declaration
interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
