"use client";

import { List } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@rosegriffon/ui";
import type { TocItem } from "@/lib/lexical-utils";

interface MobileTableOfContentsProps {
	items: TocItem[];
}

export function MobileTableOfContents({ items }: MobileTableOfContentsProps) {
	const [activeId, setActiveId] = useState<string>("");
	const [open, setOpen] = useState(false);
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
				const visible = entries.filter((e) => e.isIntersecting);
				if (visible.length > 0) {
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
		<div className="lg:hidden">
			<Drawer open={open} onOpenChange={setOpen}>
				<DrawerTrigger asChild>
					<button
						className="fixed bottom-24 md:bottom-6 right-6 z-40 size-12 rounded-full bg-primary text-on-primary shadow-lg shadow-primary/30 flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
						aria-label="Sommaire"
					>
						<List className="size-5" />
					</button>
				</DrawerTrigger>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle className="flex items-center gap-2 text-on-surface">
							<List className="size-4" />
							Sommaire
						</DrawerTitle>
					</DrawerHeader>
					<nav className="px-4 pb-6 max-h-[60vh] overflow-y-auto">
						<ul className="space-y-1">
							{items.map((item) => (
								<li key={item.id}>
									<DrawerClose asChild>
										<a
											href={`#${item.id}`}
											onClick={(e) => {
												e.preventDefault();
												setOpen(false);
												setTimeout(() => {
													const el = document.getElementById(item.id);
													if (el) {
														el.scrollIntoView({ behavior: "smooth", block: "start" });
													}
												}, 300);
											}}
											className={`block text-sm py-2 px-3 rounded-lg transition-colors ${
												item.level === 3 ? "pl-6" : ""
											} ${
												activeId === item.id
													? "bg-primary/10 text-primary font-semibold"
													: "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50"
											}`}
										>
											{item.text}
										</a>
									</DrawerClose>
								</li>
							))}
						</ul>
					</nav>
				</DrawerContent>
			</Drawer>
		</div>
	);
}
