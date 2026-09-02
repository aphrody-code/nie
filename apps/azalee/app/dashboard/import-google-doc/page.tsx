import { AdminPageHeader as DashboardPageHeader } from "@rosegriffon/ui";
import { ImportDocForm } from "./ImportDocForm";
import { Icon } from "@/components/ui/Icon";

export default function ImportGoogleDocPage() {
	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				breadcrumbs={[
					{ href: "/dashboard", label: "Tableau de bord" },
					{ label: "Import Google Doc" },
				]}
				title="Import Google Doc"
				subtitle="Convertir un document Google en article"
				icon={<Icon name="description" size={20} />}
			/>

			<ImportDocForm />
		</div>
	);
}
