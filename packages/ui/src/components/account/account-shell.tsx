"use client";

import { ArrowLeft, KeyRound, Link2, Truck, UserCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "../button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../tabs";
import type { AccountTabId } from "./types";

const TAB_META: Record<AccountTabId, { label: string; icon: typeof UserCircle }> = {
	address: { icon: Truck, label: "Adresse" },
	connections: { icon: Link2, label: "Connexions" },
	profile: { icon: UserCircle, label: "Profil" },
	security: { icon: KeyRound, label: "Sécurité" },
};

interface AccountShellProps {
	email?: string | null;
	/** Lien de retour (profil public, tableau de bord…). */
	backHref?: string;
	backLabel?: string;
	initialTab: AccountTabId;
	/** Onglets montés, dans l'ordre d'affichage. */
	tabs: { id: AccountTabId; content: ReactNode }[];
}

/**
 * Coquille de la page « Mon compte », partagée par les deux apps.
 *
 * L'onglet actif est reflété dans l'URL (`?tab=…`) : un lien vers un réglage
 * précis reste partageable et le retour navigateur fonctionne. `router.replace`
 * évite d'empiler une entrée d'historique par clic d'onglet.
 */
export function AccountShell({
	email,
	backHref,
	backLabel = "Retour",
	initialTab,
	tabs,
}: AccountShellProps) {
	const router = useRouter();
	const pathname = usePathname();
	const [active, setActive] = useState<AccountTabId>(initialTab);

	const change = (next: string) => {
		setActive(next as AccountTabId);
		router.replace(`${pathname}?tab=${next}`, { scroll: false });
	};

	return (
		<div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
			{backHref && (
				<nav aria-label="Retour" className="mb-4">
					<Button variant="ghost" size="sm" asChild className="-ml-2">
						<Link href={backHref}>
							<ArrowLeft className="size-4" aria-hidden />
							{backLabel}
						</Link>
					</Button>
				</nav>
			)}

			<header className="mb-6 space-y-1">
				<h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
					Paramètres du compte
				</h1>
				{email && (
					<p className="text-sm break-all text-muted-foreground">
						Connecté en tant que <span className="font-medium text-foreground">{email}</span>
					</p>
				)}
			</header>

			<Tabs value={active} onValueChange={change} className="w-full">
				<TabsList
					aria-label="Sections du compte"
					// `grid-cols-2` en dessous de 640 px : quatre onglets côte à côte sur
					// un écran de 320 px produisent des libellés tronqués à deux lettres.
					className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:flex sm:justify-start"
				>
					{tabs.map(({ id }) => {
						const meta = TAB_META[id];
						return (
							<TabsTrigger
								key={id}
								value={id}
								className="flex min-h-11 flex-col items-center justify-center gap-0.5 px-2 text-xs sm:min-h-9 sm:flex-row sm:gap-2 sm:text-sm"
							>
								<meta.icon className="size-4 shrink-0" aria-hidden />
								<span className="truncate">{meta.label}</span>
							</TabsTrigger>
						);
					})}
				</TabsList>

				{tabs.map(({ id, content }) => (
					<TabsContent key={id} value={id} className="mt-6 focus-visible:outline-hidden">
						{content}
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
