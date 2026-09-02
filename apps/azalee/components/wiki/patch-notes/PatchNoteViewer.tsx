"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import Image from "next/image";
import { useRef, useState } from "react";
import type { PatchNoteDetail } from "@/app/actions/news";
import { PlatformBadge } from "./PlatformBadge";

interface PatchNoteViewerProps {
	data: PatchNoteDetail;
}

/**
 * Extrait le numéro de version depuis l'ID composite.
 */
function extractVersion(id: string): string | null {
	const match = id.match(/ver_(\d+(?:_\d+)*)/);
	if (!match) {
		return null;
	}
	return match[1].replaceAll("_", ".");
}

export function PatchNoteViewer({ data }: PatchNoteViewerProps) {
	const contentRef = useRef<HTMLDivElement>(null);
	const [imgError, setImgError] = useState(false);
	const dateObj = data.date ? new Date(data.date) : null;
	const version = extractVersion(data.id);

	return (
		<article className="animate-in fade-in slide-in-from-bottom-4 duration-500">
			{/* Header Banner */}
			<div className="relative rounded-[32px] overflow-hidden bg-surface-container-low border border-outline-variant/10 mb-8 p-1 group">
				{data.featured_image && !imgError ? (
					<div className="absolute inset-0">
						<Image
							src={data.featured_image}
							alt=""
							fill
							className="object-cover opacity-90 transition-transform duration-700 group-hover:scale-105"
							onError={() => setImgError(true)}
						/>
						<div className="absolute inset-0 bg-linear-to-t from-background/95 via-background/60 to-background/30" />
					</div>
				) : (
					<div className="absolute inset-0 bg-linear-to-br from-primary/5 via-transparent to-secondary/5" />
				)}

				{/* Decorator */}
				{(!data.featured_image || imgError) && (
					<div className="absolute top-0 right-0 p-32 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
				)}

				<div className="relative p-5 md:p-8 lg:p-12 flex flex-col gap-4 md:gap-6">
					<div className="flex flex-wrap items-center gap-3">
						{version && (
							<span className="text-sm font-bold bg-primary text-on-primary px-3 py-1 rounded-full">
								v{version}
							</span>
						)}
						{data.platform.map((p) => (
							<PlatformBadge
								key={p}
								platform={p}
								showLabel
								className="bg-surface/50 backdrop-blur-md border-surface-variant/20 shadow-sm"
							/>
						))}
					</div>

					<div>
						<div className="text-sm font-bold text-on-surface-variant mb-2 flex items-center gap-2">
							<span className="inline-block size-2 rounded-full bg-primary" />
							Mise a jour du {dateObj ? format(dateObj, "d MMMM yyyy", { locale: fr }) : data.date}
						</div>
						<h1 className="text-2xl md:text-4xl lg:text-5xl font-bold font-sans text-on-surface drop-shadow-sm">
							{data.title}
						</h1>
					</div>
				</div>
			</div>

			{/* Content */}
			<div
				ref={contentRef}
				className="
          prose prose-lg max-w-none
          prose-headings:font-sans prose-headings:font-bold prose-headings:text-on-surface
          prose-p:text-on-surface-variant prose-p:leading-loose prose-p:text-lg
          prose-strong:text-on-surface prose-strong:font-bold
          prose-ul:text-on-surface-variant
          prose-li:marker:text-primary

          /* Images */
          prose-img:rounded-[24px] prose-img:border prose-img:border-outline-variant/20 prose-img:shadow-sm prose-img:w-full prose-img:bg-surface-container-lowest

          /* Headers (h3 typically) - Make them look like section headers */
          [&_h3]:text-2xl [&_h3]:md:text-3xl [&_h3]:bg-surface-container-low [&_h3]:px-8 [&_h3]:py-6 [&_h3]:rounded-[24px] [&_h3]:border-l-8 [&_h3]:border-primary [&_h3]:mt-16 [&_h3]:first:mt-0

          /* h6 — used as bullet point headers in official patch notes */
          [&_h6]:text-base [&_h6]:font-bold [&_h6]:text-on-surface [&_h6]:mt-6 [&_h6]:mb-2

          /* Section wrappers */
          [&_section]:mb-16

          /* Lists */
          [&_ul]:bg-surface-container-lowest [&_ul]:p-6 [&_ul]:md:p-8 [&_ul]:rounded-[24px] [&_ul]:md:rounded-[32px] [&_ul]:border [&_ul]:border-outline-variant/20 [&_ul]:shadow-sm
          [&_li]:text-base [&_li]:md:text-lg [&_li]:mb-3 [&_li]:last:mb-0

          /* Nested lists */
          [&_ul_ul]:bg-transparent [&_ul_ul]:p-0 [&_ul_ul]:border-0 [&_ul_ul]:shadow-none [&_ul_ul]:rounded-none [&_ul_ul]:mt-2 [&_ul_ul]:ml-4
          [&_ol_ol]:mt-2 [&_ol_ol]:ml-4

          /* Details/Summary overrides if they exist */
          [&_dt]:font-bold [&_dt]:text-primary [&_dt]:mt-6 [&_dt]:text-xl
          [&_dd]:ml-6 [&_dd]:mb-6 [&_dd]:text-lg

          /* Tables (if any) */
          [&_table]:w-full [&_table]:border-collapse [&_table]:my-8
          [&_th]:text-left [&_th]:p-4 [&_th]:bg-surface-container-high [&_th]:text-on-surface [&_th]:rounded-t-xl
          [&_td]:p-4 [&_td]:border-b [&_td]:border-outline-variant/10

          /* Hide empty elements */
          [&_:empty]:hidden
        "
				dangerouslySetInnerHTML={{ __html: data.content_html }}
			/>
		</article>
	);
}
