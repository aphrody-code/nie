import { getPatchNotes } from "@/app/actions/news";
import PatchNotesDashboard from "@/components/wiki/patch-notes/PatchNotesDashboard";

export const dynamic = "force-dynamic";

export const metadata = {
	alternates: { canonical: "/patch-notes" },
	description:
		"Historique des mises a jour de Inazuma Eleven: Victory Road. Filtrez par plateforme (Switch, PS4/5, Steam).",
	title: "Notes de Mise a Jour | Azalee",
};

export default async function PatchNotesPage() {
	const initialNotes = await getPatchNotes("ps-steam");

	return (
		<div className="w-full pb-20">
			{/* Header */}
			<div className="flex flex-col gap-2 mb-8">
				<h1 className="text-3xl md:text-4xl font-bold text-on-surface tracking-tight">
					Patch Notes
				</h1>
				<p className="text-sm md:text-base text-on-surface-variant/70 max-w-xl">
					Suivi des mises a jour et correctifs du jeu par plateforme.
					{initialNotes.length > 0 && (
						<span className="ml-1 text-primary font-medium">
							{initialNotes.length} mises a jour disponibles.
						</span>
					)}
				</p>
			</div>

			<PatchNotesDashboard initialNotes={initialNotes} />
		</div>
	);
}
