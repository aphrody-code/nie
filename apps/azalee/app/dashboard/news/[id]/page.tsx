import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { NewsEditorLoader } from "../NewsEditorLoader";

interface EditNewsPageProps {
	params: Promise<{ id: string }>;
}

export default async function EditNewsPage({ params }: EditNewsPageProps) {
	const { id } = await params;
	const supabase = createAdminClient();

	const { data: news, error } = await supabase
		.from("articles")
		.select("*")
		.eq("id", id)
		.eq("app", "azalee")
		.maybeSingle();

	if (error || !news) {
		notFound();
	}

	return <NewsEditorLoader initialData={news} />;
}
