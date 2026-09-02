import Link from "next/link";
import { AdminPageHeader as DashboardPageHeader, Button } from "@rosegriffon/ui";
import { Icon } from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/server";
import { TweetRow } from "./tweet-row";

export default async function TweetsPage() {
	const supabase = await createClient();
	const { data: tweets } = await supabase
		.from("tweets")
		.select("*")
		.order("created_at", { ascending: false })
		.limit(50);

	return (
		<div className="space-y-6 sm:space-y-8">
			<DashboardPageHeader
				breadcrumbs={[{ href: "/dashboard", label: "Tableau de bord" }, { label: "Tweets" }]}
				title="Tweets"
				subtitle="Gérer le feed Twitter (X)"
				icon={<Icon name="tag" size={20} />}
				actions={
					<Button asChild className="rounded-full">
						<Link href="/dashboard/tweets/new">
							<Icon name="add" size={18} className="mr-2" />
							Nouveau Tweet
						</Link>
					</Button>
				}
			/>

			<div className="bg-surface-container rounded-3xl border border-outline-variant/20 overflow-hidden">
				{tweets?.map((tweet: any) => (
					<TweetRow key={tweet.id} tweet={tweet} />
				))}
				{(!tweets || tweets.length === 0) && (
					<div className="p-10 text-center text-on-surface-variant">Aucun tweet trouvé.</div>
				)}
			</div>
		</div>
	);
}
