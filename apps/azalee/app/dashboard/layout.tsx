import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { getServerSession, hasMedailleAzaleeRole } from "@/lib/auth-helpers";
import { ADMIN_ROLES } from "@/lib/auth-roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
	description: "Espace de gestion pour l'équipe rédactionnelle.",
	robots: { follow: false, index: false },
	title: "Administration | Azalée",
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	const session = await getServerSession();
	if (!session?.user) {
		redirect("/login");
	}

	const supabase = await createClient();

	const { data: profile } = await supabase
		.from("profiles")
		.select("role, discord_id")
		.eq("id", session.user.id)
		.single();

	if (!profile) {
		redirect("/");
	}

	const isAdmin = ADMIN_ROLES.includes(profile.role as (typeof ADMIN_ROLES)[number]);
	const isMedailleMember = !isAdmin && (await hasMedailleAzaleeRole(profile.discord_id));

	if (!isAdmin && !isMedailleMember) {
		redirect("/");
	}

	// Même structure que `/admin` du site principal : barre d'administration
	// dédiée à gauche, contenu à droite. L'autorisation vient d'être vérifiée
	// ci-dessus côté serveur, la barre est donc toujours rendue — contrairement
	// à l'ancienne permutation d'entrées dans la barre principale, filtrée par un
	// `isAdmin` client qui vidait la navigation dès qu'il retombait à faux.
	return (
		<div className="flex min-h-[calc(100dvh-4rem)] w-full">
			<DashboardSidebar />
			<div className="min-w-0 flex-1 overflow-x-hidden pt-16 pb-20 lg:pt-0 lg:pb-0">
				{children}
			</div>
		</div>
	);
}
