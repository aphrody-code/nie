// Entry point — réexporte tout. Préférer les entries spécifiques (./browser, ./server, ./service)
// dans les apps pour éviter d'embarquer le SSR runtime côté client.
// ⚠️ NE PAS réexporter ./rag ni ./rag-store ici : rag-store.ts importe `bun:sqlite` au niveau
// module → casse tout build Node (ex. website `scripts/next-build.sh`, runtime Node explicite)
// dès qu'UN SEUL fichier importe quoi que ce soit depuis le barrel `@rosegriffon/db`, même sans
// toucher au RAG (vu sur /api/bot/v1/stats via getDashboardStats). Importer explicitement
// `@rosegriffon/db/rag` / `@rosegriffon/db/rag-store` (déjà le pattern partout ailleurs).
export * from "./browser";
export * from "./server";
export * from "./service";
export * from "./profiles";
export * from "./storage";
export * from "./services/stats";
export * from "./redis";
export type * from "./types";
