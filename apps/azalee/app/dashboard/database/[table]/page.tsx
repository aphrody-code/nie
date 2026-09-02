import { notFound } from "next/navigation";
import { AdminPageHeader as DashboardPageHeader } from "@rosegriffon/ui";
import { createClient } from "@/lib/supabase/server";
import { DatabaseTableClient } from "./DatabaseTableClient";
import { Icon } from "@/components/ui/Icon";

export default async function GenericTablePage({
	params,
	searchParams,
}: {
	params: Promise<{ table: string }>;
	searchParams: Promise<{ page?: string; sort?: string; dir?: string }>;
}) {
	const { table } = await params;
	const { page, sort, dir } = await searchParams;
	const pageNum = Number.parseInt(page || "1", 10);
	const limit = 50;
	const sortCol = sort || "id";
	const sortDir = dir !== "desc";

	const supabase = await createClient();

	// Liste blanche (anti-injection). Elle DOIT couvrir toutes les tables
	// référencées par un lien `/dashboard/database/<t>` du dépôt : trois tuiles
	// de l'accueil et de l'index DB pointaient vers des tables absentes d'ici
	// et tombaient en 404 alors que leur compteur s'affichait correctement.
	const allowedTables = [
		"inagle_characters",
		"inagle_skills",
		"inagle_teams",
		"inagle_items",
		"inagle_auras",
		"inagle_keshins",
		"inagle_keshins_clean",
		"inagle_souls",
		"inagle_miximax",
		"inagle_awakenings",
		"inagle_passives",
		"inagle_formations",
	];
	if (!allowedTables.includes(table)) {
		return notFound();
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Fetch all columns via one row
	const { data: sample } = await client.from(table).select("*").limit(1);
	const allColumns = sample && sample.length > 0 ? Object.keys(sample[0]) : ["id"];

	// Fetch Data with sort
	const { data: rows, count } = await client
		.from(table)
		.select("*", { count: "exact" })
		.range((pageNum - 1) * limit, pageNum * limit - 1)
		.order(sortCol, { ascending: sortDir });

	const totalPages = Math.ceil((count || 0) / limit);

	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				breadcrumbs={[
					{ href: "/dashboard", label: "Tableau de bord" },
					{ href: "/dashboard/database", label: "Base de données" },
					{ label: table },
				]}
				title={table}
				subtitle={`${(count || 0).toLocaleString("fr-FR")} enregistrements · ${allColumns.length} colonnes`}
				icon={<Icon name="table_chart" size={20} />}
			/>

			<DatabaseTableClient
				table={table}
				rows={rows || []}
				columns={allColumns}
				currentSort={sortCol}
				currentDir={sortDir ? "asc" : "desc"}
				pageNum={pageNum}
				totalPages={totalPages}
				count={count || 0}
			/>
		</div>
	);
}
