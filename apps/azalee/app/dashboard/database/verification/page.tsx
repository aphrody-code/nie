import { requireAdmin } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";
import { AdminPageHeader as DashboardPageHeader } from "@rosegriffon/ui";
import { VerificationClient } from "./VerificationClient";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

export default async function VerificationPage() {
	await requireAdmin();

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Fetch records with missing French translations concurrently (limited to 100 for responsiveness)
	const [charsRes, skillsRes, teamsRes, itemsRes] = await Promise.all([
		client
			.from("inagle_characters")
			.select(
				"id, name_en, name_fr, name_ja, description_en, description_fr, description_ja, internal_code"
			)
			.or("name_fr.is.null,name_fr.eq.,description_fr.is.null,description_fr.eq.")
			.order("id", { ascending: true })
			.limit(100),
		client
			.from("inagle_skills")
			.select(
				"id, name_en, name_fr, name_ja, description_en, description_fr, description_ja, internal_code"
			)
			.or("name_fr.is.null,name_fr.eq.,description_fr.is.null,description_fr.eq.")
			.order("id", { ascending: true })
			.limit(100),
		client
			.from("inagle_teams")
			.select("id, name_en, name_fr, name_ja, description_en, description_fr, description_ja")
			.or("name_fr.is.null,name_fr.eq.,description_fr.is.null,description_fr.eq.")
			.order("id", { ascending: true })
			.limit(100),
		client
			.from("inagle_items")
			.select(
				"id, name_en, name_fr, name_ja, description_en, description_fr, description_ja, internal_code"
			)
			.or("name_fr.is.null,name_fr.eq.,description_fr.is.null,description_fr.eq.")
			.order("id", { ascending: true })
			.limit(100),
	]);

	const characters = charsRes.data || [];
	const skills = skillsRes.data || [];
	const teams = teamsRes.data || [];
	const items = itemsRes.data || [];

	const totalIssues = characters.length + skills.length + teams.length + items.length;

	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				breadcrumbs={[
					{ href: "/dashboard", label: "Tableau de bord" },
					{ href: "/dashboard/database", label: "Base de données" },
					{ label: "Modération en masse" },
				]}
				title="Modération & Traduction"
				subtitle={`${totalIssues} entité${totalIssues !== 1 ? "s" : ""} nécessitent une traduction française`}
				icon={<Icon name="verified" size={20} />}
			/>

			<VerificationClient
				initialCharacters={characters}
				initialSkills={skills}
				initialTeams={teams}
				initialItems={items}
			/>
		</div>
	);
}
