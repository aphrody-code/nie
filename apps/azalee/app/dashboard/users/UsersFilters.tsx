"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";

interface UsersFiltersProps {
	totalItems: number;
	currentRole: string;
}

const ROLES = [
	{ icon: "group", label: "Tous", value: "" },
	{ icon: "shield", label: "Admins", value: "admin" },
	{ icon: "verified_user", label: "Modérateurs", value: "moderator" },
	{ icon: "edit", label: "Éditeurs", value: "editor" },
	{ icon: "person", label: "Membres", value: "member" },
];

export function UsersFilters({ totalItems, currentRole }: UsersFiltersProps) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const currentQ = searchParams.get("q") || "";
	const [searchValue, setSearchValue] = useState(currentQ);
	const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	function buildHref(overrides: Record<string, string | null>) {
		const params = new URLSearchParams(searchParams.toString());
		for (const [key, value] of Object.entries(overrides)) {
			if (value === null || value === "") {
				params.delete(key);
			} else {
				params.set(key, value);
			}
		}
		if ("q" in overrides || "role" in overrides) {
			params.delete("page");
		}
		const qs = params.toString();
		return qs ? `?${qs}` : "/dashboard/users";
	}

	const handleSearch = (value: string) => {
		setSearchValue(value);
		if (searchTimerRef.current) {
			clearTimeout(searchTimerRef.current);
		}
		searchTimerRef.current = setTimeout(() => {
			router.push(buildHref({ q: value || null }));
		}, 400);
	};

	const clearSearch = () => {
		setSearchValue("");
		router.push(buildHref({ q: null }));
		inputRef.current?.focus();
	};

	return (
		<div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
			{/* Search bar */}
			<div className="relative w-full sm:w-72">
				<Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-on-surface-variant/50" />
				<input
					ref={inputRef}
					type="search"
					value={searchValue}
					onChange={(e) => handleSearch(e.target.value)}
					placeholder="Rechercher par nom ou email..."
					className="w-full h-12 pl-10 pr-10 rounded-full bg-surface-container-low border border-outline-variant/50 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
				/>
				{searchValue && (
					<button
						onClick={clearSearch}
						className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-surface-container-highest text-on-surface-variant/50 hover:text-on-surface transition-colors"
						aria-label="Effacer la recherche"
					>
						<X className="size-4" />
					</button>
				)}
			</div>

			{/* Role filters */}
			<div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide w-full sm:w-auto pb-0.5">
				{ROLES.map((r) => {
					const isActive = currentRole === r.value;
					return (
						<Link
							key={r.value || "all"}
							href={buildHref({ role: r.value || null })}
							className={`flex items-center gap-1.5 h-10 px-3 sm:px-4 rounded-full font-medium text-xs transition-all whitespace-nowrap shrink-0 ${
								isActive
									? "bg-secondary-container text-on-secondary-container shadow-sm"
									: "bg-surface text-on-surface-variant border border-outline-variant/50 hover:bg-surface-container-high hover:border-outline"
							}`}
						>
							<Icon name={r.icon} size={16} className={isActive ? "" : "opacity-60"} />
							{r.label}
						</Link>
					);
				})}
			</div>

			{/* Count */}
			<span className="text-xs text-on-surface-variant/60 ml-auto shrink-0">
				{totalItems} résultat{totalItems !== 1 ? "s" : ""}
			</span>
		</div>
	);
}
