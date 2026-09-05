import { expect, test } from "bun:test";
import { romaji, romajiNom } from "../kana.ts";

test("furigana du zukan → romaji Hepburn", () => {
    expect(romajiNom("あふろ てるみ")).toBe("Afuro Terumi");
    expect(romajiNom("えんどう まもる")).toBe("Endou Mamoru");
    expect(romajiNom("ごうえんじ しゅうや")).toBe("Gouenji Shuuya");
    expect(romajiNom("きどう ゆうと")).toBe("Kidou Yuuto");
});

test("katakana : la lecture, pas l'adaptation commerciale", () => {
    // アフロディ se LIT « afurodi ». « Aphrody » est un choix de localisation, pas une
    // romanisation — ne jamais attendre de la table qu'elle le devine.
    expect(romaji("アフロディ")).toBe("afurodi");
    expect(romaji("フィディオ")).toBe("fidio");
});

test("digrammes, sokuon, allongement, n syllabique", () => {
    expect(romaji("しゃ")).toBe("sha");
    expect(romaji("はっと")).toBe("hatto");
    // L'apostrophe ne s'ajoute QUE devant une voyelle ou y : « shin'ichi » leve l'ambiguite
    // avec « shinichi », alors que « konnichiha » n'en a aucune a lever.
    expect(romaji("しんいち")).toBe("shin'ichi");
    expect(romaji("こんにちは")).toBe("konnichiha");
    expect(romaji("サッカー")).toBe("sakkaa");
});

test("ce qui n'est pas du kana passe tel quel", () => {
    expect(romaji("Byron Love")).toBe("Byron Love");
    expect(romaji("")).toBe("");
});
