import "server-only";

import "@/lib/azalee-runtime";

/**
 * Trophées et succès.
 *
 * Façade Next au-dessus de `@rosegriffon/azalee/wiki/trophies` : la logique vit dans
 * la bibliothèque (utilisable en CLI et en sidecar Tauri), ce fichier n'ajoute
 * que la garde `server-only` et l'injection du client de données.
 */

export * from "@rosegriffon/azalee/wiki/trophies";
