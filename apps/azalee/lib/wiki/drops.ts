import "server-only";

import "@/lib/azalee-runtime";

/**
 * Taux de drop et sources.
 *
 * Façade Next au-dessus de `@rosegriffon/azalee/wiki/drops` : la logique vit dans
 * la bibliothèque (utilisable en CLI et en sidecar Tauri), ce fichier n'ajoute
 * que la garde `server-only` et l'injection du client de données.
 */

export * from "@rosegriffon/azalee/wiki/drops";
