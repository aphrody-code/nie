/**
 * Règles de jeu pures : formations (83 réelles + 8 legacy), recalcul de stats
 * de membre, synergies d'élément, genre, cut-ins, emblèmes d'équipe.
 * Aucun I/O — utilisable en navigateur comme en CLI.
 */

export * from "./formations";
export * from "./gender";
export * from "./item-categories";
export * from "./personality";
export * from "./roster-resolver";
export * from "./skills-cutin";
export * from "./stats-interpolation";
export * from "./team-code";
export * from "./team-emblem-map";
export * from "./team-rules";
export * from "./team-types";
