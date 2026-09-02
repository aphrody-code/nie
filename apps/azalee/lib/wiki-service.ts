import "server-only";

import "@/lib/azalee-runtime";

/**
 * Façade serveur du service wiki (personnages, techniques, objets, auras, tactiques, galerie, passives).
 *
 * Façade Next au-dessus de `@rosegriffon/azalee/wiki/service` : la logique vit dans
 * la bibliothèque (utilisable en CLI et en sidecar Tauri), ce fichier n'ajoute
 * que la garde `server-only` et l'injection du client de données.
 */

export * from "@rosegriffon/azalee/wiki/service";
