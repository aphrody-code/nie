import { notFound } from "next/navigation";
import { getArticleVersions, restoreArticleVersion } from "@/app/actions/articles";
import { AdminPageHeader as DashboardPageHeader } from "@rosegriffon/ui";
import { createClient } from "@/lib/supabase/server";
import { VersionsList } from "./VersionsList";
import { Icon } from "@/components/ui/Icon";

interface VersionsPageProps {
	params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: VersionsPageProps) {
	const { id } = await params;
	return {
		title: `Historique des versions — ${id}`,
	};
}

export default async function VersionsPage({ params }: VersionsPageProps) {
	const { id } = await params;
	const supabase = await createClient();

	const { data: article } = await supabase
		.from("articles")
		.select("id, title, slug")
		.eq("id", id)
		.eq("app", "azalee")
		.maybeSingle();

	if (!article) {
		notFound();
	}

	const versions = await getArticleVersions(article.id);

	return (
		<div className="space-y-6">
			<DashboardPageHeader
				breadcrumbs={[
					{ href: "/dashboard", label: "Tableau de bord" },
					{ href: "/dashboard/news", label: "Actualités" },
					{ href: `/dashboard/news/${article.id}`, label: article.title },
					{ label: "Versions" },
				]}
				title="Historique des versions"
				subtitle={`${versions.length} version${versions.length !== 1 ? "s" : ""} pour "${article.title}"`}
				icon={<Icon name="history" size={20} />}
			/>

			{versions.length > 0 ? (
				<VersionsList
					versions={versions}
					articleId={article.id}
					restoreAction={restoreArticleVersion}
				/>
			) : (
				<div className="text-center py-20">
					<p className="text-on-surface-variant">Aucune version enregistrée pour cet article.</p>
					<p className="text-xs text-on-surface-variant/60 mt-2">
						Les versions sont créées automatiquement à chaque sauvegarde.
					</p>
				</div>
			)}
		</div>
	);
}
