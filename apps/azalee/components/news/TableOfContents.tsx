"use client";

import { List } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TocItem } from "@/lib/lexical-utils";

interface TableOfContentsProps {
	items: TocItem[];
}

export function TableOfContents({ items }: TableOfContentsProps) {
	const [activeId, setActiveId] = useState<string>("");
	const observerRef = useRef<IntersectionObserver | null>(null);

	useEffect(() => {
		if (items.length === 0) {
			return;
		}

		const headingElements = items
			.map((item) => document.getElementById(item.id))
			.filter(Boolean) as HTMLElement[];

		if (headingElements.length === 0) {
			return;
		}

		observerRef.current = new IntersectionObserver(
			(entries) => {
				// Find the first heading that is intersecting (visible)
				const visible = entries.filter((e) => e.isIntersecting);
				if (visible.length > 0) {
					// Pick the one closest to the top
					const sorted = visible.toSorted(
						(a, b) => a.boundingClientRect.top - b.boundingClientRect.top
					);
					setActiveId(sorted[0].target.id);
				}
			},
			{
				rootMargin: "-80px 0px -60% 0px",
				threshold: 0,
			}
		);

		headingElements.forEach((el) => observerRef.current?.observe(el));

		return () => {
			observerRef.current?.disconnect();
		};
	}, [items]);

	if (items.length === 0) {
		return null;
	}

	return (
		<nav className="p-5 rounded-2xl bg-surface-container-low border border-outline-variant/10">
			<div className="flex items-center gap-2 mb-4">
				<List className="size-4 text-on-surface-variant/60" />
				<h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60">
					Sommaire
				</h3>
			</div>
			<ul className="space-y-1">
				{items.map((item) => (
					<li key={item.id}>
						<a
							href={`#${item.id}`}
							onClick={(e) => {
								e.preventDefault();
								const el = document.getElementById(item.id);
								if (el) {
									el.scrollIntoView({ behavior: "smooth", block: "start" });
									setActiveId(item.id);
								}
							}}
							className={`block text-xs py-1.5 transition-all duration-200 rounded-lg px-3 ${
								item.level === 3 ? "pl-6" : ""
							} ${
								activeId === item.id
									? "bg-primary/10 text-primary font-semibold"
									: "text-on-surface-variant/70 hover:text-on-surface hover:bg-surface-container-high/50"
							}`}
						>
							{item.text}
						</a>
					</li>
				))}
			</ul>
		</nav>
	);
}
