import type { Database } from "@rosegriffon/db";

/** Horaire de stream. */
export type StreamSchedule = Database["public"]["Tables"]["stream_schedules"]["Row"];

/** Horaire pour affichage (alias avec types strings pour les colonnes time). */
export interface PlanningRow {
	day_of_week: number;
	streamer_name: string;
	start_time: string | null;
	end_time: string | null;
	category: string | null;
	notes: string | null;
}

/** Statut d'un horaire. */
export type StreamStatus = "active" | "inactive" | "coming_soon";
