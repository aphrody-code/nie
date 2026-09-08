import { useEffect, useSyncExternalStore } from "react";
import type { Locale } from "./settings";

export interface ResolvedName {
  /** Exact database identity, when supplied by the owning data resolver. */
  id?: string;
  kind: "chara" | "skill" | "item" | "tactic" | "team" | "keshin" | "soul";
  name: string;
  extra: string | null;
}
export type NameResolver = (source: string, codes: string[], locale: Locale) => Promise<Map<string, ResolvedName>>;

/** One cache per host resolver. Source and locale remain part of every lookup identity. */
function createStore() {
  const values = new Map<string, ResolvedName | null>();
  const pending = new Set<string>();
  const listeners = new Set<() => void>();
  let revision = 0;
  return {
    values, pending,
    snapshot: () => revision,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    notify: () => { revision++; for (const listener of listeners) listener(); },
  };
}
const stores = new WeakMap<NameResolver, ReturnType<typeof createStore>>();
const emptyResolver: NameResolver = async () => new Map();
const keyOf = (source: string, locale: Locale, code: string) => JSON.stringify([source, locale, code]);

/** Batched resolution with notification of every mounted consumer sharing an in-flight query. */
export function useResolvedNames(optionalResolver: NameResolver | undefined, source: string, locale: Locale, codes: string[]) {
  const resolver = optionalResolver ?? emptyResolver;
  let store = stores.get(resolver);
  if (!store) { store = createStore(); stores.set(resolver, store); }
  const current = store;
  useSyncExternalStore(current.subscribe, current.snapshot, current.snapshot);
  const signature = JSON.stringify([...new Set(codes.filter(Boolean))]);
  useEffect(() => {
    if (!optionalResolver || !source.trim()) return;
    const requested: string[] = JSON.parse(signature);
    const missing = requested.filter(code => !current.values.has(keyOf(source, locale, code)) && !current.pending.has(keyOf(source, locale, code)));
    if (!missing.length) return;
    for (const code of missing) current.pending.add(keyOf(source, locale, code));
    const settle = (resolved: Map<string, ResolvedName>) => {
      for (const code of missing) {
        const key = keyOf(source, locale, code);
        current.values.set(key, resolved.get(code) ?? null);
        current.pending.delete(key);
      }
      current.notify();
    };
    const retry = () => {
      // Failure is not a missing-name result. A later mount or changed batch may
      // retry; notification alone leaves this effect's dependencies unchanged.
      for (const code of missing) current.pending.delete(keyOf(source, locale, code));
      current.notify();
    };
    void Promise.resolve().then(() => resolver(source, missing, locale)).then(settle, retry);
  }, [current, resolver, optionalResolver, source, locale, signature]);
  const result = new Map<string, ResolvedName>();
  for (const code of codes) {
    const value = current.values.get(keyOf(source, locale, code));
    if (value) result.set(code, value);
  }
  return result;
}

/** Display-only composition. Never use this label as a VFS or database key. */
export function nameWithId(name: string | null | undefined, id: string): string {
  const label = name?.trim();
  return label && label !== id ? `${label} · ${id}` : id;
}

export function localizedName(row: { name_fr: string | null; name_en: string | null; name_ja: string | null }, locale: Locale, id: string) {
  return [row[`name_${locale}`], row.name_en, row.name_fr, row.name_ja].find(name => name?.trim())?.trim() ?? id;
}

const KIND_LABELS: Record<Locale, Record<ResolvedName["kind"], string>> = {
  fr: { chara: "personnage", skill: "technique", item: "objet", tactic: "tactique", team: "équipe", keshin: "esprit guerrier", soul: "totem" },
  en: { chara: "character", skill: "skill", item: "item", tactic: "tactic", team: "team", keshin: "fighting spirit", soul: "soul" },
  ja: { chara: "キャラクター", skill: "必殺技", item: "アイテム", tactic: "タクティクス", team: "チーム", keshin: "化身", soul: "ソウル" },
};
export function resolvedKindLabel(kind: ResolvedName["kind"], locale: Locale) { return KIND_LABELS[locale][kind]; }
