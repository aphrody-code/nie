"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@rosegriffon/ui";

interface TagsSectionProps {
	tags: string[];
	onTagsChange: (tags: string[]) => void;
}

const MAX_TAGS = 10;

export function TagsSection({ tags, onTagsChange }: TagsSectionProps) {
	const [inputValue, setInputValue] = useState("");
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [showSuggestions, setShowSuggestions] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const suggestionsRef = useRef<HTMLDivElement>(null);

	// Fetch existing tags for suggestions
	const fetchSuggestions = useCallback(
		async (query: string) => {
			if (!query || query.length < 2) {
				setSuggestions([]);
				return;
			}
			try {
				const { getPopularTags } = await import("@/app/actions/articles");
				const popular = await getPopularTags(50);
				const filtered = popular
					.map((t) => t.tag)
					.filter((t) => t.toLowerCase().includes(query.toLowerCase()) && !tags.includes(t))
					.slice(0, 5);
				setSuggestions(filtered);
			} catch {
				setSuggestions([]);
			}
		},
		[tags]
	);

	useEffect(() => {
		const timer = setTimeout(() => fetchSuggestions(inputValue), 300);
		return () => clearTimeout(timer);
	}, [inputValue, fetchSuggestions]);

	// Close suggestions on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (
				suggestionsRef.current &&
				!suggestionsRef.current.contains(e.target as Node) &&
				inputRef.current &&
				!inputRef.current.contains(e.target as Node)
			) {
				setShowSuggestions(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	const addTag = (tag: string) => {
		const trimmed = tag.trim().toLowerCase();
		if (!trimmed || tags.includes(trimmed) || tags.length >= MAX_TAGS) {
			return;
		}
		onTagsChange([...tags, trimmed]);
		setInputValue("");
		setSuggestions([]);
		setShowSuggestions(false);
	};

	const removeTag = (tag: string) => {
		onTagsChange(tags.filter((t) => t !== tag));
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" || e.key === ",") {
			e.preventDefault();
			addTag(inputValue);
		} else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
			const lastTag = tags.at(-1);
			if (lastTag) {
				removeTag(lastTag);
			}
		}
	};

	return (
		<div className="space-y-3">
			{/* Tags chips */}
			{tags.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{tags.map((tag) => (
						<span
							key={tag}
							className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-secondary-container text-on-secondary-container text-xs font-medium"
						>
							{tag}
							<button
								type="button"
								onClick={() => removeTag(tag)}
								className="hover:text-on-secondary-container/70 transition-colors"
								aria-label={`Supprimer le tag ${tag}`}
							>
								<X className="size-3" />
							</button>
						</span>
					))}
				</div>
			)}

			{/* Input */}
			{tags.length < MAX_TAGS && (
				<div className="relative">
					<Input
						ref={inputRef}
						value={inputValue}
						onChange={(e) => {
							setInputValue(e.target.value);
							setShowSuggestions(true);
						}}
						onKeyDown={handleKeyDown}
						onFocus={() => setShowSuggestions(true)}
						className="bg-surface-container-high border-none rounded-xl text-xs h-8 font-sans"
						placeholder={tags.length === 0 ? "Ajouter des tags..." : "Ajouter..."}
						aria-label="Ajouter un tag"
					/>

					{/* Suggestions dropdown */}
					{showSuggestions && suggestions.length > 0 && (
						<div
							ref={suggestionsRef}
							className="absolute z-10 top-full mt-1 w-full bg-surface-container-high rounded-xl shadow-lg border border-outline-variant/20 overflow-hidden"
						>
							{suggestions.map((s) => (
								<button
									key={s}
									type="button"
									onClick={() => addTag(s)}
									className="w-full text-left px-3 py-2 text-xs hover:bg-surface-container-highest transition-colors"
								>
									{s}
								</button>
							))}
						</div>
					)}
				</div>
			)}

			<p className="text-[10px] text-muted-foreground/50">
				{tags.length}/{MAX_TAGS} tags — Entree ou virgule pour ajouter
			</p>
		</div>
	);
}
