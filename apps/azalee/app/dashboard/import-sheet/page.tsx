import { AdminPageHeader as DashboardPageHeader } from "@rosegriffon/ui";
import { ImportSheetForm } from "./ImportSheetForm";
import { Icon } from "@/components/ui/Icon";

export default function ImportSheetPage() {
	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				breadcrumbs={[
					{ href: "/dashboard", label: "Tableau de bord" },
					{ label: "Import Tableur" },
				]}
				title="Import Tableur"
				subtitle="Convertir Sheet ou CSV en tableau"
				icon={<Icon name="table_chart" size={20} />}
			/>

			<ImportSheetForm />
		</div>
	);
}
