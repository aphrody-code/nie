// Données de jeu STATIQUES, décodées EN DIRECT du VFS via les vrais parseurs typés de
// `nie-data` (crate déjà déclarée dans le workspace mais jamais câblée avant, cf. demande
// utilisatrice « toutes les features, api et code de niers et des crates doivent être
// utilisable et utilisé dans l'app ») — indépendant du miroir wiki azalee (`SearchView`) : aucun
// `supabase-*.sqlite` requis, aucune requête réseau, juste les fichiers `.cfg.bin` du jeu monté.
//
// Cinq jeux de données câblés (techniques, objets, Avatar/Keshin, succès, quêtes) : ~110 autres
// modules `nie-data` (personnages, boutiques, tactiques…) suivent le même patron côté Rust
// (`src-tauri/src/game_data.rs`), à étendre au besoin — même pont `load_t2b` déjà vérifié réel
// (tests `list_*_sur_le_vrai_jeu`).
import { useEffect, useMemo, useState } from "react";
import { api, type Aura, type CharaPicker, type Item, type Quest, type Skill, type StatBlock, type Trophy } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Kind = "skills" | "items" | "auras" | "trophies" | "quests" | "stats";

const KIND_LABELS: Record<Kind, string> = {
  skills: "Techniques",
  items: "Objets",
  auras: "Avatar / Keshin",
  trophies: "Succès",
  quests: "Quêtes",
  stats: "Calculateur de stats",
};

/** rarityCode → libellé FR (cf. doc Rust `game_data::calculate_character_stats`). */
const RARITY_LABELS: [number, string][] = [
  [0, "N"], [2, "R"], [3, "SR"], [4, "SSR"], [5, "UR"], [6, "LR"], [7, "Legend"], [20, "BASARA"],
];

/** Onglet « Calculateur de stats » (§4.2 roadmap) : choisir un personnage + niveau + rareté, voir
 * les 7 stats calculées via `nie_core::growth::calculate_stats` (tables IEVR embarquées). */
function StatsCalculator() {
  const settings = useSettings();
  const [roster, setRoster] = useState<CharaPicker[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CharaPicker | null>(null);
  const [level, setLevel] = useState(50);
  const [rarity, setRarity] = useState(0);
  const [stats, setStats] = useState<StatBlock | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    setRosterLoading(true);
    api
      .gameDataCharaPicker(settings.gameDir)
      .then(setRoster)
      .catch((e) => setRosterError(String(e)))
      .finally(() => setRosterLoading(false));
  }, [settings.gameDir]);

  const filtered = useFiltered(roster, query, (c) => [c.name, c.main_position]);

  useEffect(() => {
    if (!selected) {
      setStats(null);
      return;
    }
    setStatsLoading(true);
    setStatsError(null);
    api
      .gameDataCalculateStats(selected.chara_param_id, level, rarity, settings.gameDir)
      .then(setStats)
      .catch((e) => setStatsError(String(e)))
      .finally(() => setStatsLoading(false));
  }, [selected, level, rarity, settings.gameDir]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,1fr)_1.2fr] gap-3">
      <div className="flex min-h-0 flex-col gap-2">
        <Input placeholder="Rechercher un personnage…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {rosterError && (
          <Alert variant="destructive">
            <AlertTitle>Échec du décodage</AlertTitle>
            <AlertDescription>{rosterError}</AlertDescription>
          </Alert>
        )}
        <ScrollArea className="min-h-0 flex-1 rounded-xl bg-surface-container-low elevation-1">
          <div className="divide-y divide-outline-variant/30">
            {filtered.map((c) => (
              <button
                key={c.chara_param_id}
                className={`state-layer flex w-full items-center justify-between gap-2 px-3 py-2 text-left type-body-medium ${
                  selected?.chara_param_id === c.chara_param_id ? "bg-secondary-container text-on-secondary-container" : "text-on-surface"
                }`}
                onClick={() => setSelected(c)}
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <Badge variant="outline">{c.main_position}</Badge>
              </button>
            ))}
            {!rosterLoading && filtered.length === 0 && (
              <p className="p-4 type-body-small text-on-surface-variant">Aucun personnage ne correspond.</p>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 flex-col gap-3 rounded-xl bg-surface-container-low p-4 elevation-1">
        {!selected ? (
          <p className="type-body-medium text-on-surface-variant">Sélectionnez un personnage à gauche.</p>
        ) : (
          <>
            <h3 className="type-title-small text-on-surface">
              {selected.name} <span className="type-label-small text-on-surface-variant">({selected.main_position})</span>
            </h3>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <label className="type-label-small text-on-surface-variant" htmlFor="stat-level">
                  Niveau
                </label>
                <Input
                  id="stat-level"
                  type="number"
                  min={1}
                  max={99}
                  value={level}
                  onChange={(e) => setLevel(Math.min(99, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-24"
                />
              </div>
              <div className="space-y-1.5">
                <span className="type-label-small text-on-surface-variant">Rareté</span>
                <Select value={String(rarity)} onValueChange={(v) => v && setRarity(Number(v))}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RARITY_LABELS.map(([code, label]) => (
                      <SelectItem key={code} value={String(code)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {statsError && (
              <Alert variant="destructive">
                <AlertTitle>Échec du calcul</AlertTitle>
                <AlertDescription>{statsError}</AlertDescription>
              </Alert>
            )}
            {stats && (
              <div className="grid grid-cols-4 gap-2 type-body-medium">
                {(
                  [
                    ["Kick", stats.kc],
                    ["Control", stats.cr],
                    ["Technique", stats.tc],
                    ["Power", stats.pr],
                    ["Pressure", stats.ps],
                    ["Agility", stats.ag],
                    ["Intelligence", stats.it],
                  ] as [string, number][]
                ).map(([label, val]) => (
                  <div key={label} className="rounded-lg bg-surface-container p-2 text-center">
                    <div className="type-label-small text-on-surface-variant">{label}</div>
                    <div className="type-title-small text-on-surface">{val}</div>
                  </div>
                ))}
                <div className="col-span-4 rounded-lg bg-primary-container p-2 text-center text-on-primary-container">
                  <div className="type-label-small">Total</div>
                  <div className="type-title-medium">{stats.total}</div>
                </div>
              </div>
            )}
            {statsLoading && <p className="type-body-small text-on-surface-variant">calcul…</p>}
          </>
        )}
      </div>
    </div>
  );
}

export function GameDataView() {
  const settings = useSettings();
  const [kind, setKind] = useState<Kind>("skills");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [auras, setAuras] = useState<Aura[]>([]);
  const [trophies, setTrophies] = useState<Trophy[]>([]);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    // L'onglet Stats a son propre chargement (`StatsCalculator`, roster + calcul à la demande),
    // pas de liste générique filtrable ici.
    if (kind === "stats") return;
    setLoading(true);
    setError(null);
    const byKind: Record<Exclude<Kind, "stats">, () => Promise<void>> = {
      skills: () => api.gameDataSkills(settings.gameDir).then(setSkills),
      items: () => api.gameDataItems(settings.gameDir).then(setItems),
      auras: () => api.gameDataAuras(settings.gameDir).then(setAuras),
      trophies: () => api.gameDataTrophies(settings.gameDir).then(setTrophies),
      quests: () => api.gameDataQuests(settings.gameDir).then(setQuests),
    };
    byKind[kind]()
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [kind, settings.gameDir]);

  const filteredSkills = useFiltered(skills, query, (s) => [s.skill_id_str, s.name ?? "", s.element, s.category]);
  const filteredItems = useFiltered(items, query, (i) => [i.item_id, i.name, i.category]);
  const filteredAuras = useFiltered(auras, query, (a) => [a.aura_id, a.name, a.element, a.sub_type]);
  const filteredTrophies = useFiltered(trophies, query, (t) => [t.trophy_id, t.name, t.code]);
  const filteredQuests = useFiltered(quests, query, (q) => [q.quest_id, q.title]);

  const total = kind === "stats" ? 0 : { skills: skills.length, items: items.length, auras: auras.length, trophies: trophies.length, quests: quests.length }[kind];
  const filteredCount =
    kind === "stats"
      ? 0
      : {
          skills: filteredSkills.length,
          items: filteredItems.length,
          auras: filteredAuras.length,
          trophies: filteredTrophies.length,
          quests: filteredQuests.length,
        }[kind];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <Tabs value={kind} onValueChange={(v) => v && setKind(v as Kind)}>
        <TabsList>
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <TabsTrigger key={k} value={k} className="type-label-large state-layer">
              {KIND_LABELS[k]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {kind === "stats" ? (
        <StatsCalculator />
      ) : (
        <>
      <div className="flex items-center gap-2">
        <Input placeholder="Filtrer…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
        <span className="type-label-small text-on-surface-variant">
          {loading ? "chargement…" : `${filteredCount.toLocaleString("fr-FR")} / ${total.toLocaleString("fr-FR")}`}
        </span>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Échec du décodage</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ScrollArea className="min-h-0 flex-1 rounded-xl bg-surface-container-low elevation-1">
        <div className="divide-y divide-outline-variant/30">
          {kind === "skills" &&
            filteredSkills.map((s) => (
              <div key={s.skill_id_str} className="flex flex-wrap items-center gap-2 px-3 py-2 type-body-medium">
                <span className="min-w-0 flex-1 truncate text-on-surface">{s.name ?? s.skill_id_str}</span>
                <span className="type-label-small text-on-surface-variant">{s.skill_id_str}</span>
                <Badge variant="outline">{s.element}</Badge>
                <Badge variant="outline">{s.category}</Badge>
                <span className="type-label-small text-on-surface-variant">
                  {s.power_min}–{s.power_max}
                </span>
                <span className="type-label-small text-on-surface-variant">TP {s.consume_tp}</span>
                {s.eldorado && <Badge>Eldorado</Badge>}
              </div>
            ))}
          {kind === "items" &&
            filteredItems.map((i) => (
              <div key={i.item_id} className="flex flex-wrap items-center gap-2 px-3 py-2 type-body-medium">
                <span className="min-w-0 flex-1 truncate text-on-surface" title={i.description ?? undefined}>
                  {i.name}
                </span>
                <Badge variant="outline">{i.category}</Badge>
                {i.price != null && <span className="type-label-small text-on-surface-variant">{i.price.toLocaleString("fr-FR")} G</span>}
              </div>
            ))}
          {kind === "auras" &&
            filteredAuras.map((a) => (
              <div key={a.aura_id} className="flex flex-wrap items-center gap-2 px-3 py-2 type-body-medium">
                <span className="min-w-0 flex-1 truncate text-on-surface" title={a.description ?? undefined}>
                  {a.name}
                </span>
                <Badge variant="outline">{a.element}</Badge>
                <Badge variant="outline">{a.sub_type}</Badge>
              </div>
            ))}
          {kind === "trophies" &&
            filteredTrophies.map((t) => (
              <div key={t.trophy_id} className="flex flex-wrap items-center gap-2 px-3 py-2 type-body-medium">
                <span className="min-w-0 flex-1 truncate text-on-surface" title={t.description ?? undefined}>
                  {t.name}
                </span>
                <Badge variant="outline">{t.unlock_kind}</Badge>
                {t.story_episode != null && <span className="type-label-small text-on-surface-variant">épisode {t.story_episode}</span>}
              </div>
            ))}
          {kind === "quests" &&
            filteredQuests.map((q) => (
              <div key={q.quest_id} className="flex flex-wrap items-center gap-2 px-3 py-2 type-body-medium">
                <span className="min-w-0 flex-1 truncate text-on-surface">{q.title}</span>
                <span className="type-label-small text-on-surface-variant">phase {q.phase}</span>
              </div>
            ))}
          {!loading && filteredCount === 0 && (
            <p className="p-4 type-body-small text-on-surface-variant">Aucun résultat ne correspond.</p>
          )}
        </div>
      </ScrollArea>
        </>
      )}
    </div>
  );
}

/** Filtre insensible à la casse sur un ensemble de champs texte extraits par élément. */
function useFiltered<T>(list: T[], query: string, fields: (item: T) => string[]): T[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => fields(item).some((f) => f.toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, query]);
}
