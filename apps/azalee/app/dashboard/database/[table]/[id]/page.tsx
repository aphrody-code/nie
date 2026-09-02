import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@rosegriffon/ui";
import { createClient } from "@/lib/supabase/server";
import { GenericEditorForm } from "./generic-editor-form";

export default async function GenericRowPage({
	params,
}: {
	params: Promise<{ table: string; id: string }>;
}) {
	const { table, id } = await params;
	const supabase = await createClient();

	const { data: row } = await (supabase as any).from(table).select("*").eq("id", id).single();

	if (!row) {
		return <div>Enregistrement non trouvé.</div>;
	}

	return (
		<div className="p-6 md:p-10 space-y-6">
			<div className="flex items-center gap-4">
				<Button asChild variant="ghost" size="icon">
					<Link href={`/dashboard/database/${table}`}>
						<ChevronLeft className="size-5" />
					</Link>
				</Button>
				<div>
					<h1 className="text-2xl font-bold font-grade-high">Édition : {id}</h1>
					<p className="text-sm text-on-surface-variant">Table : {table}</p>
				</div>
			</div>

			<div className="bg-surface-container rounded-[32px] p-8 border border-outline-variant/20">
				<GenericEditorForm table={table} initialData={row} />
			</div>
		</div>
	);
}
