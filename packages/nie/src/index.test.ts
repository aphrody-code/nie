/**
 * Preuve du round-trip Rust <-> Bun pour libnie_ffi.
 *
 * Ces tests appellent RÉELLEMENT le code Rust via bun:ffi (dlopen sur
 * target/debug/libnie_ffi.so) et assertent des valeurs exactes connues du
 * moteur niers (vérité terrain). Un bug FFI est une corruption silencieuse,
 * pas une exception : on compare donc des octets/entiers précis, pas "truthy".
 *
 * Lancer :   cd /home/aphrody/niers && bun test
 * Prérequis: cargo build -p nie-ffi   (génère target/debug/libnie_ffi.so)
 */

import { test, expect, describe } from "bun:test";
import { crc32, CRand, version } from "./index.ts";

// ─── référence CRC32 pure-JS (IEEE 802.3, poly 0xEDB88320) ────────────────────
const _crcTable: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32Ref(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ _crcTable[(crc ^ bytes[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

// ─────────────────────────────────────────────────────────────────────────────
// CRC32
// ─────────────────────────────────────────────────────────────────────────────

describe("crc32 (Rust nie_crc32 via FFI)", () => {
  test("vérité terrain : crc32('Focus') === 0xA30165ED", () => {
    expect(crc32("Focus")).toBe(0xa30165ed);
    expect(crc32("Focus")).toBe(2734777837);
  });

  test("vecteur zlib : crc32('123456789') === 0xCBF43926", () => {
    expect(crc32("123456789")).toBe(0xcbf43926);
  });

  test("chaîne vide : crc32('') === 0 (ptr non déref, len 0)", () => {
    expect(crc32("")).toBe(0);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  test("retourne un u32 non signé (>>> 0), jamais négatif", () => {
    const v = crc32("Focus");
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });

  test("non-ASCII (accents + CJK) : FFI == oracle JS sur les octets UTF-8", () => {
    const samples = [
      "café",
      "Ñoño",
      "Crème brûlée",
      "日本語",
      "イナズマイレブン",
      "勝利の道",
      "🔥⚽",
      "Ω≈ç√∫˜µ≤",
    ];
    for (const s of samples) {
      const bytes = utf8(s);
      const fromRust = crc32(s);
      const fromRustBuf = crc32(bytes);
      const oracle = crc32Ref(bytes);
      expect(fromRust).toBe(oracle);
      expect(fromRustBuf).toBe(oracle);
    }
  });

  test("octets binaires bruts (0x00..0xFF) : FFI == oracle JS", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(crc32(bytes)).toBe(crc32Ref(bytes));
  });

  test("tampon > 2^16 octets : FFI == oracle JS", () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    expect(crc32(bytes)).toBe(crc32Ref(bytes));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRand (MT19937)
// ─────────────────────────────────────────────────────────────────────────────

describe("CRand (Rust nie_crand_* via FFI)", () => {
  test("vérité terrain MT19937 seed 5489 : 3 premiers tirages exacts", () => {
    using rng = new CRand(5489);
    expect(rng.nextU32()).toBe(3499211612);
    expect(rng.nextU32()).toBe(581869302);
    expect(rng.nextU32()).toBe(3890346734);
  });

  test("nextU32 reste dans [0, 2^32) sur 1000 tirages", () => {
    using rng = new CRand(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextU32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  test("bounded(n) dans [0, n) sur 10000 tirages, plusieurs bornes", () => {
    using rng = new CRand(777);
    for (const n of [1, 2, 6, 7, 100, 1000, 0xffffffff]) {
      for (let i = 0; i < 10000; i++) {
        const v = rng.bounded(n);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(n);
      }
    }
  });

  test("bounded couvre toute la plage [0,6) (pas dégénéré)", () => {
    using rng = new CRand(2024);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(rng.bounded(6));
    expect(seen.size).toBe(6);
  });

  test("bounded(0) === tirage brut (sémantique byte-exacte, pas 0)", () => {
    using a = new CRand(99);
    using b = new CRand(99);
    expect(a.bounded(0)).toBe(b.nextU32());
    expect(a.nextU32()).toBe(b.nextU32());
  });

  test("nextF32 dans [0.0, 1.0) sur 10000 tirages", () => {
    using rng = new CRand(7);
    for (let i = 0; i < 10000; i++) {
      const f = rng.nextF32();
      expect(f).toBeGreaterThanOrEqual(0.0);
      expect(f).toBeLessThan(1.0);
    }
  });

  test("deux instances même graine = séquences identiques", () => {
    using a = new CRand(0xbeef);
    using b = new CRand(0xbeef);
    for (let i = 0; i < 50; i++) expect(a.nextU32()).toBe(b.nextU32());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRand.fromU64
// ─────────────────────────────────────────────────────────────────────────────

describe("CRand.fromU64 (graine 64 bits)", () => {
  const foldU32 = (seed: bigint): number =>
    Number((seed ^ (seed >> 32n)) & 0xffffffffn);

  test("moitié haute nulle : fromU64(n) == new CRand(n)", () => {
    using a = CRand.fromU64(12345n);
    using b = new CRand(12345);
    expect(a.nextU32()).toBe(b.nextU32());
  });

  test("seed > 2^32 : les bits hauts participent (BigInt traverse en u64)", () => {
    const seed = 0x123456789abcdef0n;
    const expectedLow = foldU32(seed);
    expect(expectedLow).toBe(0x88888888);

    using folded  = CRand.fromU64(seed);
    using viaNew  = new CRand(expectedLow);
    using lowOnly = new CRand(Number(seed & 0xffffffffn));

    const a = folded.nextU32();
    expect(a).toBe(viaNew.nextU32());
    expect(a).not.toBe(lowOnly.nextU32());
  });

  test("seed = u64::MAX traverse sans perte", () => {
    const seed = 0xffffffffffffffffn;
    using folded = CRand.fromU64(seed);
    using zero   = new CRand(foldU32(seed));
    expect(foldU32(seed)).toBe(0);
    expect(folded.nextU32()).toBe(zero.nextU32());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gestion mémoire
// ─────────────────────────────────────────────────────────────────────────────

describe("gestion du handle (ownership)", () => {
  test("free() explicite ne crashe pas et est idempotent", () => {
    const rng = new CRand(1);
    rng.nextU32();
    expect(() => rng.free()).not.toThrow();
    expect(() => rng.free()).not.toThrow();
  });

  test("usage après free() lève une erreur (garde, pas de UB)", () => {
    const rng = new CRand(1);
    rng.free();
    expect(() => rng.nextU32()).toThrow();
    expect(() => rng.bounded(10)).toThrow();
    expect(() => rng.nextF32()).toThrow();
  });

  test("[Symbol.dispose] / using libère sans crash", () => {
    let captured = 0;
    {
      using rng = new CRand(42);
      captured = rng.nextU32();
    }
    expect(Number.isInteger(captured)).toBe(true);
  });

  test("dispose direct équivaut à free", () => {
    const rng = new CRand(5);
    rng.nextU32();
    expect(() => rng[Symbol.dispose]()).not.toThrow();
    expect(() => rng.nextU32()).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// version()
// ─────────────────────────────────────────────────────────────────────────────

describe("version (Rust nie_version -> CString)", () => {
  test("retourne une chaîne non vide", () => {
    const v = version();
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });

  test("correspond au CARGO_PKG_VERSION ('0.1.0')", () => {
    const v = version();
    expect(v).toBe("0.1.0");
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
