"use client";

import { ListFilter, Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import {
	Button,
	Input,
	ScrollArea,
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@rosegriffon/ui";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

interface WikiSearchToolbarProps {
	placeholder?: string;
	showFilters?: boolean;
	children?: React.ReactNode;
	filterKeys?: string[];
	className?: string;
	containerClassName?: string;
}

export function WikiSearchToolbar({
	placeholder,
	showFilters = true,
	children,
	filterKeys = [],
	className,
	containerClassName,
}: WikiSearchToolbarProps) {
	const { t } = useLanguage();
	const router = useRouter();
	const searchParams = useSearchParams();
	const pathname = usePathname();

	// Use localized default if placeholder is not provided
	const finalPlaceholder = placeholder || t("search.placeholder");

	// Local state for input value to avoid laggy typing
	const [query, setQuery] = useState(searchParams.get("q") || "");

	// Sync state with URL if URL changes externally (React bail-out sur set identique)
	useEffect(() => {
		const q = searchParams.get("q");
		if (q !== null) {
			setQuery(q);
		}
	}, [searchParams]);

	// Debounced Search Update
	useEffect(() => {
		const timer = setTimeout(() => {
			const currentQ = searchParams.get("q") || "";
			if (query === currentQ) {
				return;
			}

			const params = new URLSearchParams(searchParams.toString());

			if (query) {
				params.set("q", query);
			} else {
				params.delete("q");
			}

			// Reset page on search
			params.delete("page");

			router.replace(`${pathname}?${params.toString()}`);
		}, 400); // 400ms debounce

		return () => clearTimeout(timer);
	}, [query, router, pathname, searchParams]);

	// Handle Clear
	const handleClear = () => {
		setQuery("");
	};

	// Count active filters (excluding 'q' and 'page')
	const activeFilterCount = [...searchParams.entries()].filter(
		([key]) => key !== "q" && key !== "page"
	).length;

	const isDesktop = useMediaQuery("(min-width: 768px)");

	const handleResetFilters = () => {
		const params = new URLSearchParams(searchParams.toString());
		filterKeys.forEach((k) => params.delete(k));
		router.push(`${pathname}?${params.toString()}`);
	};

	const filterButton = (
		<Button
			variant={activeFilterCount > 0 ? "secondary" : "ghost"}
			size="sm"
			className={cn(
				"rounded-full gap-2 px-4 transition-all h-10 md:h-9",
				activeFilterCount > 0 && "font-bold"
			)}
		>
			{activeFilterCount > 0 ? (
				<ListFilter size={18} aria-hidden="true" />
			) : (
				<SlidersHorizontal size={18} aria-hidden="true" />
			)}
			<span>{t("search.filters_button")}</span>
			{activeFilterCount > 0 && (
				<span className="flex items-center justify-center bg-primary text-on-primary text-[10px] size-5 rounded-full ml-0.5">
					{activeFilterCount}
				</span>
			)}
		</Button>
	);

	return (
		<div className={cn("relative group w-full", containerClassName || "max-w-sm")}>
			{/* Animated Gradient Border - Gemini Style */}
			<div className="absolute -inset-0.5 bg-linear-to-r from-[#4facfe] via-[#7367f0] to-[#9733ee] rounded-full blur opacity-0 group-focus-within:opacity-20 transition duration-500" />

			<div
				className={cn(
					"relative flex items-center w-full max-w-2xl bg-surface-container-high transition-all duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
					"border border-outline-variant/40 rounded-full shadow-sm hover:shadow-level-1 focus-within:shadow-level-1 focus-within:border-indigo-400/50",
					"p-1 pr-2",
					className
				)}
			>
				{/* Search Icon */}
				<div className="pl-4 pr-2 text-on-surface-variant">
					<Search size={24} aria-hidden="true" className="select-none" />
				</div>

				{/* Input */}
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={finalPlaceholder}
					aria-label={finalPlaceholder}
					className="flex-1 bg-transparent border-none shadow-none focus-visible:ring-0 h-11 sm:h-10 text-base"
				/>

				{/* Clear Button (if query exists) */}
				{query && (
					<Button
						variant="ghost"
						size="icon"
						onClick={handleClear}
						aria-label="Effacer la recherche"
						className="size-10 md:size-8 rounded-full text-on-surface-variant hover:bg-surface-container-highest"
					>
						<X size={18} aria-hidden="true" />
					</Button>
				)}

				<div className="w-px h-6 bg-outline-variant/40 mx-2" />

				{/* Filter Trigger */}
				{showFilters && (
					<FilterContainer
						isDesktop={isDesktop}
						filterButton={filterButton}
						onReset={handleResetFilters}
						applyLabel={t("search.apply_filters")}
						resetLabel={t("search.reset")}
						title={t("search.advanced_filters")}
						description={t("search.refine_results")}
					>
						{children}
					</FilterContainer>
				)}
			</div>
		</div>
	);
}

/**
 * Responsive filter container: Drawer on mobile, Sheet on desktop
 */
function FilterContainer({
	isDesktop,
	filterButton,
	onReset,
	applyLabel,
	resetLabel,
	title,
	description,
	children,
}: {
	isDesktop: boolean;
	filterButton: React.ReactNode;
	onReset: () => void;
	applyLabel: string;
	resetLabel: string;
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	if (isDesktop) {
		return (
			<Sheet>
				<SheetTrigger asChild>{filterButton}</SheetTrigger>
				<SheetContent
					side="right"
					className="w-full sm:w-[400px] md:w-[540px] flex flex-col h-full"
				>
					<SheetHeader>
						<SheetTitle className="flex items-center gap-2 text-xl">
							<SlidersHorizontal size={24} aria-hidden="true" />
							{title}
						</SheetTitle>
						<SheetDescription>{description}</SheetDescription>
					</SheetHeader>
					<ScrollArea className="flex-1 -mx-6 px-6 my-6">{children}</ScrollArea>
					<SheetFooter className="mt-auto pt-6 border-t border-border">
						<div className="flex w-full gap-3">
							<Button variant="ghost" onClick={onReset} className="flex-1">
								{resetLabel}
							</Button>
							<SheetClose asChild>
								<Button type="submit" className="flex-[2]">
									{applyLabel}
								</Button>
							</SheetClose>
						</div>
					</SheetFooter>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Drawer>
			<DrawerTrigger asChild>{filterButton}</DrawerTrigger>
			<DrawerContent className="max-h-[85dvh]">
				<DrawerHeader>
					<DrawerTitle className="flex items-center gap-2 text-xl">
						<SlidersHorizontal size={24} aria-hidden="true" />
						{title}
					</DrawerTitle>
				</DrawerHeader>
				<ScrollArea className="flex-1 px-4 overflow-y-auto">{children}</ScrollArea>
				<DrawerFooter className="pt-4 border-t border-border">
					<div className="flex w-full gap-3">
						<Button variant="ghost" onClick={onReset} className="flex-1">
							{resetLabel}
						</Button>
						<DrawerClose asChild>
							<Button type="submit" className="flex-[2]">
								{applyLabel}
							</Button>
						</DrawerClose>
					</div>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}
