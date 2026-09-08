import { QuestCard as SharedQuestCard } from "@niers/inacord-ui/components/wiki/wiki/QuestCard";
import type { Quest } from "@/lib/wikiTypes";

export interface QuestCardProps {
	quest: Quest;
	className?: string;
}

/** Desktop adapter preserves VFS-derived quest types. */
export function QuestCard({ quest, className }: QuestCardProps) {
	return <SharedQuestCard quest={quest} className={className} />;
}
