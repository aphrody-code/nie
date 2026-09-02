"use client";

import dynamic from "next/dynamic";
import type { PickerCharacter } from "@/components/tools/my-team/CharacterPicker";

const TeamBuilder = dynamic(
	() => import("@/components/tools/my-team/TeamBuilder").then((m) => m.TeamBuilder),
	{
		loading: () => (
			<div className="flex flex-col gap-4 animate-pulse p-4">
				<div className="h-10 bg-surface-container rounded-xl w-64" />
				<div className="h-[500px] bg-surface-container rounded-3xl" />
			</div>
		),
		ssr: false,
	}
);

export function TeamBuilderLoader({
	characters,
	isAuthenticated,
}: {
	characters: PickerCharacter[];
	isAuthenticated: boolean;
}) {
	return <TeamBuilder characters={characters} isAuthenticated={isAuthenticated} />;
}
