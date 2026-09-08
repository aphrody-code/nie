"use client";

import { useRouter, useSearchParams } from "../../../../compat/next";
import { useCallback } from "react";
import { GalleryFilters, type GalleryCategoryOption } from "../../../../gallery/GalleryFilters";
export type { GalleryCategoryOption } from "../../../../gallery/GalleryFilters";

interface GalleryFilterBarProps {
	categories: GalleryCategoryOption[];
	currentCategory: string;
}

export function GalleryFilterBar({ categories, currentCategory }: GalleryFilterBarProps) {
	const router = useRouter();
	const searchParams = useSearchParams();

	const updateCategory = useCallback(
		(value: string) => {
			const params = new URLSearchParams(searchParams.toString());
			if (value && value !== "all") {
				params.set("category", value);
			} else {
				params.delete("category");
			}
			params.delete("page");
			const qs = params.toString();
			router.push(qs ? `/gallery?${qs}` : "/gallery");
		},
		[router, searchParams]
	);

	return <GalleryFilters categories={categories} currentCategory={currentCategory} onCategoryChange={updateCategory} />;
}
