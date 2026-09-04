/**
 * Accès au code du dépôt via la FFI — le MÊME moteur que `niers find`/`grep` et que les
 * commandes Tauri de l'app desktop (`nie_explore::depot`).
 *
 * Ces tests valident la traversée complète TS → `nie_depot_json_out` → Rust → JSON, y compris
 * le confinement : c'est la seule couche où une régression de sécurité (chemin hors du dépôt)
 * serait invisible depuis les tests Rust, qui ne passent pas par l'ABI C.
 */

import { describe, expect, test } from "bun:test";
import { depotChercher, depotLire, depotLister, depotTrouver, ErreurDepot } from "./index.ts";

/** Racine du dépôt : `packages/nie/src` → trois niveaux au-dessus. */
const RACINE = `${import.meta.dir}/../../..`;

describe("depot", () => {
  test("lit un fichier source du dépôt", () => {
    const f = depotLire(RACINE, "crates/engine/nie-explore/Cargo.toml");
    expect(f.binaire).toBe(false);
    expect(f.contenu).toContain("nie-explore");
    expect(f.chemin).toBe("crates/engine/nie-explore/Cargo.toml");
    expect(f.taille).toBeGreaterThan(0);
  });

  test("tronque à la demande sans mentir sur la taille", () => {
    const f = depotLire(RACINE, "crates/engine/nie-explore/src/depot.rs", 128);
    expect(f.contenu?.length).toBeLessThanOrEqual(128);
    expect(f.tronque).toBe(true);
    expect(f.taille).toBeGreaterThan(128);
  });

  test("liste la racine sans les dossiers non-code", () => {
    const entrees = depotLister(RACINE);
    const noms = entrees.map((e) => e.nom);
    expect(noms).toContain("crates");
    expect(noms).toContain("packages");
    for (const exclu of ["data", "target", "node_modules", ".git", "var"]) {
      expect(noms).not.toContain(exclu);
    }
  });

  test("trouve des fichiers par extension", () => {
    const hits = depotTrouver(RACINE, "depot", {
      sous_dossier: "crates/engine/nie-explore",
      extensions: ["rs"],
      limite: 20,
    });
    expect(hits.some((h) => h.endsWith("nie-explore/src/depot.rs"))).toBe(true);
  });

  test("cherche dans le contenu et rend des lignes situées", () => {
    const hits = depotChercher(RACINE, "DOSSIERS_EXCLUS", {
      sous_dossier: "crates/engine/nie-explore/src",
      extensions: ["rs"],
      limite: 20,
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.ligne).toBeGreaterThanOrEqual(1);
      expect(h.chemin).toContain("nie-explore");
    }
  });

  test("refuse de sortir du dépôt", () => {
    expect(() => depotLire(RACINE, "../../../etc/passwd")).toThrow(ErreurDepot);
  });

  test("refuse les dossiers exclus", () => {
    expect(() => depotLire(RACINE, "target/debug/nie_ffi.dll")).toThrow(ErreurDepot);
    expect(() => depotLire(RACINE, ".git/HEAD")).toThrow(ErreurDepot);
  });

  test("refuse les fichiers de secrets", () => {
    // Le dépôt porte un vrai `.env.local` : sans barrière, il traversait la FFI en entier.
    for (const secret of [".env.local", "apps/azalee/.env.local"]) {
      expect(() => depotLire(RACINE, secret)).toThrow(ErreurDepot);
    }
  });

  test("les secrets ne remontent pas dans une recherche", () => {
    const hits = depotTrouver(RACINE, ".env", { caches: true, limite: 500 });
    expect(hits.filter((h) => h.includes(".env"))).toEqual([]);
  });

  test("rend une erreur lisible plutôt qu'un résultat vide", () => {
    try {
      depotLire(RACINE, "crates/inexistant-xyz.rs");
      throw new Error("aurait dû lever");
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurDepot);
      expect((e as ErreurDepot).message).toContain("introuvable");
    }
  });
});
