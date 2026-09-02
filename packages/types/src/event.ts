import type { Database } from "@rosegriffon/db";

/** Événement Rose Griffon. */
export type Event = Database["public"]["Tables"]["events"]["Row"];

/** Événement pour affichage (alias). */
export type EventRow = Event;

/** Insert payload. */
export type EventInsert = Database["public"]["Tables"]["events"]["Insert"];

/** Update payload. */
export type EventUpdate = Database["public"]["Tables"]["events"]["Update"];
