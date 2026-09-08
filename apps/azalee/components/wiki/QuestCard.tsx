import { QuestCard as SharedQuestCard } from "@niers/inacord-ui/components/wiki/wiki/QuestCard";
import type { Quest } from "@/lib/wiki/quests";

export interface QuestCardProps {
	quest: Quest;
	className?: string;
}

/** Azalée adapter preserves its query/result type. */
export function QuestCard({ quest, className }: QuestCardProps) {
	return <SharedQuestCard quest={quest} className={className} />;
}
