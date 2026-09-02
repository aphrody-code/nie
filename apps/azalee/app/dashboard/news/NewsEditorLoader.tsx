"use client";

import dynamic from "next/dynamic";

const NewsEditorForm = dynamic(
	() => import("@/components/dashboard/news-editor/NewsEditorForm").then((m) => m.NewsEditorForm),
	{
		loading: () => (
			<div className="flex flex-col gap-4 animate-pulse p-6">
				<div className="h-10 bg-surface-container rounded-xl w-1/2" />
				<div className="h-[600px] bg-surface-container rounded-2xl" />
			</div>
		),
		ssr: false,
	}
);

export function NewsEditorLoader({ initialData }: { initialData?: any }) {
	return <NewsEditorForm initialData={initialData} />;
}
