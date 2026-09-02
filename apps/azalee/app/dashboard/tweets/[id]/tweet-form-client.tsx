"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Textarea } from "@rosegriffon/ui";
import { saveTweet } from "../actions";

export function TweetFormClient({ initialData }: { initialData?: any }) {
	const [text, setText] = useState(initialData?.text || "");
	const [loading, setLoading] = useState(false);
	const router = useRouter();

	const handleSave = async () => {
		setLoading(true);
		try {
			const result = await saveTweet({
				author_name: initialData?.author_name || "Rose Griffon",
				author_username: initialData?.author_username || "RoseGriffon",
				id: initialData?.id,
				text,
			});

			if (!result.success) {
				throw new Error(result.error);
			}

			toast.success("Tweet enregistré");
			router.push("/dashboard/tweets");
			router.refresh();
		} catch (error: any) {
			console.error(error);
			toast.error(error.message || "Erreur lors de l'enregistrement");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<label className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
					Contenu du tweet
				</label>
				<Textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					className="h-[70vh] bg-surface-container-high border-none rounded-xl text-lg resize-y"
					placeholder="Quoi de neuf ?"
				/>
			</div>
			<div className="flex justify-end">
				<Button onClick={handleSave} disabled={loading} className="rounded-full px-8">
					{loading ? "Enregistrement..." : "Enregistrer"}
				</Button>
			</div>
		</div>
	);
}
