import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPatchNoteDetail } from "@/app/actions/news";
import { PatchNoteViewer } from "@/components/wiki/patch-notes/PatchNoteViewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const note = await getPatchNoteDetail(id);
	const title = note?.title || "Patch Note";
	return {
		alternates: { canonical: `/patch-notes/${id}` },
		description: `Détail de la mise à jour : ${title}. Inazuma Eleven: Victory Road.`,
		title: `${title} | Azalée`,
	};
}

export default async function PatchNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const note = await getPatchNoteDetail(id);

	if (!note) {
		notFound();
	}

	return (
		<div className="w-full pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
			<PatchNoteViewer data={note} />
		</div>
	);
}
