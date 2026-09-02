import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TweetFormClient } from "./tweet-form-client";

export default async function TweetEditorPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const isNew = id === "new";

	let tweet = null;

	if (!isNew) {
		const supabase = await createClient();
		let { data } = await supabase.from("tweets").select("*").eq("id", id).maybeSingle();
		if (!data) {
			const { data: threadTweet } = await supabase
				.from("tweets")
				.select("*")
				.contains("raw_tweets", [{ id }])
				.maybeSingle();
			data = threadTweet;
		}
		tweet = data;
	}

	return (
		<div className="space-y-6 sm:space-y-8">
			<Link
				href="/dashboard/tweets"
				className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-primary transition-colors"
			>
				<ChevronLeft className="size-4" />
				Retour aux tweets
			</Link>

			<div>
				<h1 className="text-3xl font-black text-on-surface font-grade-high">
					{isNew ? "Nouveau Tweet" : "Modifier le Tweet"}
				</h1>
			</div>

			<div className="bg-surface-container rounded-[32px] p-8 border border-outline-variant/20">
				<TweetFormClient initialData={tweet} />
			</div>
		</div>
	);
}
