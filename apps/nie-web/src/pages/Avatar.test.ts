import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  initSync,
  avatar_composition_json,
  avatar_reference_import_json,
  export_avatar_oc_document_json,
} from "../wasm/nie_wasm.js";
import { avatarModelUrl } from "@niers/inacord-ui/avatar/request";
import type { AvatarComposition } from "@niers/inacord-ui/avatar/contract";

const catalog = {
  categories: [
    {
      faceSettingType: 17,
      parts: [
        {
          id: "body-male",
          resource: "edit_body_male",
          modeles2: [
            "data/common/chr/_face/20_EDIT/_bodySK/sk_male/sk_male.g4sk",
          ],
        },
        {
          id: "body-female",
          resource: "edit_body_female",
          modeles2: [
            "data/common/chr/_face/20_EDIT/_bodySK/sk_female/sk_female.g4sk",
          ],
        },
        {
          id: "body-small",
          resource: "edit_body_small",
          modeles2: [
            "data/common/chr/_face/20_EDIT/_bodySK/sk_small/sk_small.g4sk",
          ],
        },
      ],
    },
    { faceSettingType: 9, parts: [{ id: "D64E1016", itemNo: 1 }] },
    {
      faceSettingType: 3,
      couleurs: ["skin-light", "skin-dark"],
      parts: [{
        id: "skin",
        modeles: ["data/dx11/chr/_face/20_EDIT/_facetex/00_face/skin.g4tx"],
      }],
    },
    {
      faceSettingType: 4,
      couleurs: ["hair-dark", "hair-blue"],
      parts: [
        {
          id: "paired",
          modeles: ["data/common/chr/_face/20_EDIT/_hairF/front.g4md"],
          modeles2: ["data/common/chr/_face/20_EDIT/_hairB/back.g4md"],
        },
        {
          id: "back-only",
          modeles2: ["data/common/chr/_face/20_EDIT/_hairB/selected.g4md"],
        },
      ],
    },
    {
      faceSettingType: 6,
      couleurs: ["eye-brown", "eye-green"],
      parts: [
        {
          id: "eye",
          modeles: ["data/dx11/chr/_face/20_EDIT/_facetex/01_eye/eye.g4tx"],
        },
      ],
    },
    {
      faceSettingType: 10,
      parts: [
        { id: "mouth-a", modeles: ["data/dx11/chr/_face/20_EDIT/_facetex/04_mouth/mouth_a.g4tx"] },
        { id: "mouth-b", modeles: ["data/dx11/chr/_face/20_EDIT/_facetex/04_mouth/mouth_b.g4tx"] },
      ],
    },
  ],
  couleursRgb: {
    "skin-light": { rgb: "F3CAC1", alpha: 1 },
    "skin-dark": { rgb: "8A5A44", alpha: 1 },
    "hair-dark": { rgb: "221811", alpha: 1 },
    "hair-blue": { rgb: "55AAEE", alpha: 1 },
    "eye-brown": { rgb: "533B3B", alpha: 1 },
    "eye-green": { rgb: "22CC88", alpha: 1 },
  },
  voix: [
    { banque: "scoutMAA01", genre: 1, personnalite: 1, ton: 0, itemNo: 0 },
    { banque: "scoutFAA01", genre: 2, personnalite: 1, ton: 0, itemNo: 0 },
  ],
  personnalites: [
    { type: 0, presentation: 0, texte: "none", libelle: "Sans" },
    { type: 1, presentation: 2, texte: "energy", libelle: "Énergique" },
  ],
  modelesDeBase: {
    morphologies: ["male", "female", "small"],
    visages: [
      { noseType: "nose_type_01", resources: ["male_nose", "female_nose", "small_nose"] },
    ],
  },
};
const resolve = (state: unknown): AvatarComposition =>
  JSON.parse(
    avatar_composition_json(JSON.stringify(catalog), JSON.stringify(state)),
  );
beforeAll(() =>
  initSync({
    module: readFileSync(
      new URL("../../public/static/game/nie_wasm_bg.wasm", import.meta.url),
    ),
  }),
);

describe("avatar host uses the actual compiled Rust resolver", () => {
  test("keeps every mobile chrome control in the visible column without changing the scene ratio", () => {
    const css = readFileSync(
      new URL("./avatar-studio.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toContain("flex-direction: column");
    // The responsive override changes only the chrome. The 1920×1080 scene remains owned by
    // GameCanvas and its contain scale, so this stylesheet must not invent another aspect ratio.
    expect(css).not.toContain("aspect-ratio:");
  });

  test("publishes Chara Edit without the desktop authoring workspaces", () => {
    const source = readFileSync(new URL("./Avatar.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("InacordWorkspace");
    expect(source).not.toContain("GameTabStrip");
    expect(source).not.toContain('id: "avatar-ui"');
    expect(source).not.toContain('id: "menus"');
    expect(source).toContain('const STAGES = ["style", "body", "hair", "stats", "name"]');
  });

  test("the selected secondary-only hair reaches the shared request with face texture", () => {
    const composition = resolve({ selections: { 4: "back-only" }, height: 7 });
    const url = avatarModelUrl(composition);
    expect(url).toContain(
      "_bodySK/sk_male+_facebase/male_nose+_hairB/selected.glb",
    );
    expect(new URL(url, "https://example.invalid").searchParams.get("face")).toContain("01_eye/eye");
    expect(url).not.toContain("front");
    expect(url).toContain("taille=7");
  });
  test("gender uses matching skeleton, morphology and head instead of only changing a label", () => {
    const female = resolve({ gender: 1 });
    expect(female.morphology).toBe("female");
    expect(female.skeleton).toBe("sk_female");
    expect(
      female.pieces.find((piece) => piece.directory === "_facebase")?.name,
    ).toBe("female_nose");
    expect(
      female.warnings.some(
        (warning) => warning.code === "unverified_default_part",
      ),
    ).toBe(true);
  });
  test("an explicit body choice changes the shared morphology, skeleton and head recipe", () => {
    const small = resolve({ selections: { 17: "body-small" } });
    const url = new URL(avatarModelUrl(small), "https://example.invalid");
    expect(small).toMatchObject({ morphology: "small", skeleton: "sk_small" });
    expect(url.pathname).toContain("_bodySK/sk_small+_facebase/small_nose");
    expect(url.searchParams.get("morpho")).toBe("small");
  });
  test("face and hair choices change decoded layers and mesh pieces in the GLB request", () => {
    const selected = resolve({ selections: { 4: "paired", 10: "mouth-b" } });
    const url = new URL(avatarModelUrl(selected), "https://example.invalid");
    expect(url.pathname).toContain("_hairF/front+_hairB/back.glb");
    expect(url.searchParams.get("face")).toContain("04_mouth/mouth_b");
  });
  test("the three supported palettes change the assembler tint and hair parameters", () => {
    const selected = resolve({ paletteSelections: { 3: 1, 4: 1, 6: 1 } });
    const url = new URL(avatarModelUrl(selected), "https://example.invalid");
    expect(selected).toMatchObject({
      skinColor: "8A5A44",
      irisColor: "22CC88",
      hairColor: "55AAEE",
    });
    expect(url.searchParams.get("tint")).toBe("8A5A44,22CC88,FFFFFF");
    expect(url.searchParams.get("hair")).toBe("55AAEE");
  });
  test("name and stats survive the compiled Rust resolver as one validated profile recipe", () => {
    const profile = {
      name: "Ari",
      nickname: "Ace",
      uniformName: "NIE",
      shirtNumber: 42,
      element: 2,
      mainPosition: 2,
      subPosition: 3,
      buildType: 4,
      personality: 1,
      voice: 0,
      kick: null,
      control: null,
      technique: null,
      pressure: null,
      physical: null,
      agility: null,
      intelligence: null,
    };
    expect(resolve({ profile }).profile).toEqual(profile);
    expect(() => resolve({ profile: { ...profile, shirtNumber: 100 } })).toThrow();
    expect(() => resolve({ profile: { ...profile, voice: 1 } })).toThrow();
  });
  test("invalid selections cannot turn into unrelated fallback models", () => {
    expect(() => resolve({ selections: { 4: "absent" } })).toThrow();
    expect(() => resolve({ height: 15 })).toThrow();
    expect(() => avatar_composition_json("{}", "{}")).toThrow();
  });

  test("the compiled Rust owner imports real player links and keeps share slots syntax-only", () => {
    const zukan = JSON.parse(avatar_reference_import_json(
      JSON.stringify(catalog), "{}",
      "https://zukan.inazuma.jp/fr/chara_model_view/?q=hN2cl56NnpyLmo2glpvdxaTdnM_Kz83LyM_P3aKC",
    ));
    expect(zukan).toEqual({ kind: "zukan_player", internalCode: "c05024700", referenceOnly: true });
    const azalee = JSON.parse(avatar_reference_import_json(
      JSON.stringify(catalog), "{}", "https://azalee.rosegriffon.fr/chara/astro-lor",
    ));
    expect(azalee).toEqual({ kind: "azalee_player", identifier: "astro-lor", referenceOnly: true });

    const shareCatalog = {
      ...catalog,
      codePartage: {
        bits: 4,
        alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_".split(""),
        emplacements: Array.from({ length: 4 }, () => ({ bits: 1, emplacement: 0, valeurs: 2, categorie: 0, param: 0, paramSub: 0 })),
      },
    };
    expect(JSON.parse(avatar_reference_import_json(JSON.stringify(shareCatalog), "{}", "e"))).toEqual({
      kind: "share_code", rawSlots: [1, 0, 1, 0], referenceOnly: true,
    });
    expect(() => avatar_reference_import_json(JSON.stringify(shareCatalog), "{}", "e0")).toThrow();
    expect(() => avatar_reference_import_json(JSON.stringify(shareCatalog), "{}", "f")).toThrow();
    const outOfRange = {
      ...shareCatalog,
      codePartage: {
        ...shareCatalog.codePartage,
        bits: 2,
        emplacements: [{ bits: 2, emplacement: 0, valeurs: 3, categorie: 0, param: 0, paramSub: 0 }],
      },
    };
    expect(() => avatar_reference_import_json(JSON.stringify(outOfRange), "{}", "m")).toThrow();
  });

  test("the compiled Rust owner serializes and validates the OC document", () => {
    const document = JSON.parse(export_avatar_oc_document_json(
      JSON.stringify(catalog),
      JSON.stringify({ profile: { kick: 120, intelligence: 130 } }),
      JSON.stringify({
        slug: "rust-owned-oc", internalCode: null, generationRecipe: null,
        references: [{
          kind: "glb", value: "avatar.glb", bytes: 4096, sha256: "a".repeat(64),
          provenance: "validated by nie-render3d",
        }],
        provenance: ["Chara Edit session; no filesystem write performed"],
      }),
    ));
    expect(document).toMatchObject({
      schema: "niers.oc.avatar-document/v1",
      slug: "rust-owned-oc",
      avatarState: { profile: { kick: 120, intelligence: 130 } },
      references: [{ kind: "glb", bytes: 4096, sha256: "a".repeat(64) }],
    });
    expect(() => export_avatar_oc_document_json(
      JSON.stringify(catalog), "{}", JSON.stringify({ slug: "invalid slug" }),
    )).toThrow();
  });
});
