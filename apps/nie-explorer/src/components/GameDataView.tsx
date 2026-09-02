// Données de jeu STATIQUES, décodées EN DIRECT du VFS via les vrais parseurs typés de
// `nie-data` (crate déjà déclarée dans le workspace mais jamais câblée avant, cf. demande
// utilisatrice « toutes les features, api et code de niers et des crates doivent être
// utilisable et utilisé dans l'app ») — indépendant du miroir wiki azalee (`SearchView`) : aucun
// `supabase-*.sqlite` requis, aucune requête réseau, juste les fichiers `.cfg.bin` du jeu monté.
//
// Seize jeux de données câblés (techniques, objets, Avatar/Keshin, succès, quêtes, boutiques,
// stades, capacités passives, tactiques spéciales, écussons, galerie, feintes, activités, équipes,
// formations, uniformes) : les autres modules `nie-data` suivent le même patron côté Rust
// (`src-tauri/src/game_data.rs`), à étendre au besoin — mêmes ponts `load_t2b`/`load_rdbn` déjà
// vérifiés réels (tests `list_*_sur_le_vrai_jeu`).
import { useEffect, useState } from "react";
import {
  api,
  type Activity,
  type Aura,
  type BelongTeam,
  type Emblem,
  type Formation,
  type Gallery,
  type Item,
  type Passive,
  type Quest,
  type Shop,
  type Skill,
  type SpecialTactics,
  type Stadium,
  type Trick,
  type Trophy,
  type Uniform,
} from "@/lib/api";
import { useFiltered } from "@/lib/filtrage";
import { useSettings } from "@/lib/settings";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PropertyEditor } from "@/components/PropertyEditor";
import { StatCalculator } from "@/components/tools/StatCalculator";

type Kind =
  | "skills"
  | "items"
  | "auras"
  | "trophies"
  | "quests"
  | "shops"
  | "stadiums"
  | "passives"
  | "tactics"
  | "emblems"
  | "gallery"
  | "tricks"
  | "activities"
  | "teams"
  | "formations"
  | "uniforms"
  | "stats";

const KIND_LABELS: Record<Kind, string> = {
  skills: "Techniques",
  items: "Objets",
  auras: "Avatar / Keshin",
  trophies: "Succès",
  quests: "Quêtes",
  shops: "Boutiques",
  stadiums: "Stades",
  passives: "Passifs",
  tactics: "Tactiques",
  emblems: "Écussons",
  gallery: "Galerie",
  tricks: "Feintes",
  activities: "Activités",
  teams: "Équipes",
  formations: "Formations",
  uniforms: "Uniformes",
  stats: "Calculateur de stats",
};

/**
 * Ligne de liste. Cliquable dès qu'elle porte un CODE INTERNE (`whs00340`, `c01000010`, …) : le
 * clic ouvre l'éditeur de propriétés de l'entité à droite — ses fichiers, ses `.cfg.bin`
 * éditables, et les fonctions de `nie.exe` qui la manipulent. Les entrées sans code (boutiques,
 * passifs, quêtes : identifiées par un simple hash, sans asset associé) restent de l'affichage
 * pur, sans faux affordance de clic.
 */
function Row({
  code,
  selected,
  onSelect,
  className,
  children,
}: {
  code: string | null;
  selected: string | null;
  onSelect: (code: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const active = !!code && code === selected;
  return (
    <div
      role={code ? "button" : undefined}
      tabIndex={code ? 0 : undefined}
      onClick={code ? () => onSelect(code) : undefined}
      onKeyDown={
        code
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(code);
              }
            }
          : undefined
      }
      className={`flex flex-wrap items-center gap-2 px-3 py-2 type-body-medium ${
        code ? "cursor-pointer hover:bg-app-hover" : ""
      } ${active ? "bg-accent/20" : ""} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

export function GameDataView({ onOpenFile }: { onOpenFile?: (path: string) => void }) {
  const settings = useSettings();
  const [kind, setKind] = useState<Kind>("skills");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [auras, setAuras] = useState<Aura[]>([]);
  const [trophies, setTrophies] = useState<Trophy[]>([]);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [stadiums, setStadiums] = useState<Stadium[]>([]);
  const [passives, setPassives] = useState<Passive[]>([]);
  const [tactics, setTactics] = useState<SpecialTactics[]>([]);
  const [emblems, setEmblems] = useState<Emblem[]>([]);
  const [gallery, setGallery] = useState<Gallery[]>([]);
  const [tricks, setTricks] = useState<Trick[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [teams, setTeams] = useState<BelongTeam[]>([]);
  const [formations, setFormations] = useState<Formation[]>([]);
  const [uniforms, setUniforms] = useState<Uniform[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Code interne de l'entité sélectionnée — pilote l'éditeur de propriétés à droite. */
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

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
      shops: () => api.gameDataShops(settings.gameDir).then(setShops),
      stadiums: () => api.gameDataStadiums(settings.gameDir).then(setStadiums),
      passives: () => api.gameDataPassives(settings.gameDir).then(setPassives),
      tactics: () => api.gameDataSpecialTactics(settings.gameDir).then(setTactics),
      emblems: () => api.gameDataEmblems(settings.gameDir).then(setEmblems),
      gallery: () => api.gameDataGallery(settings.gameDir).then(setGallery),
      tricks: () => api.gameDataTricks(settings.gameDir).then(setTricks),
      activities: () => api.gameDataActivities(settings.gameDir).then(setActivities),
      teams: () => api.gameDataBelongTeams(settings.gameDir).then(setTeams),
      formations: () => api.gameDataFormations(settings.gameDir).then(setFormations),
      uniforms: () => api.gameDataUniforms(settings.gameDir).then(setUniforms),
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
  const filteredShops = useFiltered(shops, query, (s) => [s.shop_id, s.name ?? "", ...s.items]);
  const filteredStadiums = useFiltered(stadiums, query, (s) => [s.field_id, s.name, s.image_path]);
  const filteredPassives = useFiltered(passives, query, (p) => [
    p.passive_id,
    p.name ?? "",
    p.description ?? "",
    p.scope,
    p.boost_type,
  ]);
  const filteredTactics = useFiltered(tactics, query, (t) => [
    t.tactics_id,
    t.internal_code,
    t.name ?? "",
    t.element,
  ]);
  const filteredEmblems = useFiltered(emblems, query, (e) => [e.emblem_id, e.emblem_name, e.large_file_path]);
  const filteredGallery = useFiltered(gallery, query, (g) => [g.gallery_id, g.img_path, g.thumb_path, g.unlock_kind]);
  const filteredTricks = useFiltered(tricks, query, (t) => [t.trick_id_name, t.trick_name, t.category, t.event_id_name]);
  const filteredActivities = useFiltered(activities, query, (a) => [a.id, a.name]);
  const filteredTeams = useFiltered(teams, query, (t) => [t.team_id, t.name ?? "", ...t.seasons]);
  const filteredFormations = useFiltered(formations, query, (f) => [f.form_id, f.noun_id]);
  const filteredUniforms = useFiltered(uniforms, query, (u) => [u.name_id, u.fielder_model_id ?? ""]);

  const total =
    kind === "stats"
      ? 0
      : {
          skills: skills.length,
          items: items.length,
          auras: auras.length,
          trophies: trophies.length,
          quests: quests.length,
          shops: shops.length,
          stadiums: stadiums.length,
          passives: passives.length,
          tactics: tactics.length,
          emblems: emblems.length,
          gallery: gallery.length,
          tricks: tricks.length,
          activities: activities.length,
          teams: teams.length,
          formations: formations.length,
          uniforms: uniforms.length,
        }[kind];
  const filteredCount =
    kind === "stats"
      ? 0
      : {
          skills: filteredSkills.length,
          items: filteredItems.length,
          auras: filteredAuras.length,
          trophies: filteredTrophies.length,
          quests: filteredQuests.length,
          shops: filteredShops.length,
          stadiums: filteredStadiums.length,
          passives: filteredPassives.length,
          tactics: filteredTactics.length,
          emblems: filteredEmblems.length,
          gallery: filteredGallery.length,
          tricks: filteredTricks.length,
          activities: filteredActivities.length,
          teams: filteredTeams.length,
          formations: filteredFormations.length,
          uniforms: filteredUniforms.length,
        }[kind];

  return (
    <div className="flex h-full min-h-0 gap-2 p-2">
      <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Tabs value={kind} onValueChange={(v) => v && setKind(v as Kind)}>
        <TabsList variant="line" className="flex-wrap">
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <TabsTrigger key={k} value={k} className="text-xs">
              {KIND_LABELS[k]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {kind === "stats" ? (
        <StatCalculator />
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

      <ScrollArea className="min-h-0 flex-1 rounded-2xl border border-app-line bg-app-dark-box">
        <div className="divide-y divide-app-line">
          {kind === "skills" &&
            filteredSkills.map((s) => (
              <Row key={s.skill_id_str} code={s.skill_id_str} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface">{s.name ?? s.skill_id_str}</span>
                <span className="type-label-small text-on-surface-variant">{s.skill_id_str}</span>
                <Badge variant="outline">{s.element}</Badge>
                <Badge variant="outline">{s.category}</Badge>
                <span className="type-label-small text-on-surface-variant">
                  {s.power_min}–{s.power_max}
                </span>
                <span className="type-label-small text-on-surface-variant">TP {s.consume_tp}</span>
                {s.eldorado && <Badge>Eldorado</Badge>}
              </Row>
            ))}
          {kind === "items" &&
            filteredItems.map((i) => (
              <Row key={i.item_id} code={i.internal_code} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface" title={i.description ?? undefined}>
                  {i.name}
                </span>
                <Badge variant="outline">{i.category}</Badge>
                {i.price != null && <span className="type-label-small text-on-surface-variant">{i.price.toLocaleString("fr-FR")} G</span>}
              </Row>
            ))}
          {kind === "auras" &&
            filteredAuras.map((a) => (
              <Row key={a.aura_id} code={a.asset_code} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface" title={a.description ?? undefined}>
                  {a.name}
                </span>
                <Badge variant="outline">{a.element}</Badge>
                <Badge variant="outline">{a.sub_type}</Badge>
              </Row>
            ))}
          {kind === "trophies" &&
            filteredTrophies.map((t) => (
              <Row key={t.trophy_id} code={t.code} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface" title={t.description ?? undefined}>
                  {t.name}
                </span>
                <Badge variant="outline">{t.unlock_kind}</Badge>
                {t.story_episode != null && <span className="type-label-small text-on-surface-variant">épisode {t.story_episode}</span>}
              </Row>
            ))}
          {kind === "quests" &&
            filteredQuests.map((q) => (
              <Row key={q.quest_id} code={null} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface">{q.title}</span>
                <span className="type-label-small text-on-surface-variant">phase {q.phase}</span>
              </Row>
            ))}
          {kind === "shops" &&
            filteredShops.map((s) => (
              <Row key={s.shop_id} code={null} selected={selectedCode} onSelect={setSelectedCode} className="flex-col items-start gap-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-on-surface">{s.name ?? s.shop_id}</span>
                  <Badge variant="outline">{s.item_count} objet(s)</Badge>
                </div>
                {s.items.length > 0 && (
                  <span className="truncate type-label-small text-on-surface-variant" title={s.items.join(", ")}>
                    {s.items.slice(0, 8).join(" · ")}
                    {s.items.length > 8 ? " …" : ""}
                  </span>
                )}
              </Row>
            ))}
          {kind === "stadiums" &&
            filteredStadiums.map((s) => (
              <Row key={s.field_id} code={s.image_path.split("/").pop() ?? null} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface" title={s.image_path}>
                  {s.name}
                </span>
                <span className="type-label-small text-on-surface-variant">{s.field_id}</span>
                {s.locked && <Badge variant="outline">à débloquer</Badge>}
              </Row>
            ))}
          {kind === "passives" &&
            filteredPassives.map((p) => (
              <Row key={p.passive_id} code={null} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface" title={p.description ?? undefined}>
                  {p.name ?? p.passive_id}
                </span>
                <Badge variant="outline">{p.scope}</Badge>
                <Badge variant="outline">{p.boost_type}</Badge>
                <span className="type-label-small text-on-surface-variant">rareté {p.rarity}</span>
              </Row>
            ))}
          {kind === "tactics" &&
            filteredTactics.map((t) => (
              <Row key={t.tactics_id} code={t.internal_code} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface" title={t.description ?? undefined}>
                  {t.name ?? t.internal_code}
                </span>
                <span className="type-label-small text-on-surface-variant">{t.internal_code}</span>
                <Badge variant="outline">{t.element}</Badge>
                <span className="type-label-small text-on-surface-variant">puissance {t.power}</span>
                {t.partner_count > 0 && (
                  <span className="type-label-small text-on-surface-variant">{t.partner_count} partenaire(s)</span>
                )}
              </Row>
            ))}
          {kind === "emblems" &&
            filteredEmblems.map((e) => (
              <Row key={e.emblem_id} code={e.is_template ? null : e.emblem_name} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface" title={e.large_file_path}>
                  {e.emblem_name || e.emblem_id}
                </span>
                <span className="type-label-small text-on-surface-variant">{e.emblem_id}</span>
                {/* Une entrée gabarit porte le jeton `<resourceID>` : ses chemins ne désignent
                 * aucun fichier tant qu'un nom d'écusson concret n'y est pas substitué. */}
                {e.is_template && <Badge variant="outline">gabarit</Badge>}
              </Row>
            ))}
          {kind === "gallery" &&
            filteredGallery.map((g) => (
              <Row key={g.gallery_id} code={g.img_path || null} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface" title={g.thumb_path}>
                  {g.img_path}
                </span>
                <Badge variant="outline">{g.unlock_kind}</Badge>
                {g.story_episode != null && (
                  <span className="type-label-small text-on-surface-variant">épisode {g.story_episode}</span>
                )}
                <span className="type-label-small text-on-surface-variant">flag {g.flg_no}</span>
              </Row>
            ))}
          {kind === "tricks" &&
            filteredTricks.map((t) => (
              <Row key={t.trick_id} code={t.trick_id_name || null} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface">{t.trick_name || t.trick_id_name}</span>
                <span className="type-label-small text-on-surface-variant">{t.trick_id_name}</span>
                <Badge variant="outline">{t.category}</Badge>
                {t.has_fail_event && <Badge variant="outline">échec scripté</Badge>}
              </Row>
            ))}
          {kind === "activities" &&
            filteredActivities.map((a) => (
              <Row key={a.id} code={null} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface">{a.name}</span>
                {a.is_root ? (
                  <Badge>racine</Badge>
                ) : (
                  <span className="type-label-small text-on-surface-variant">parent {a.parent_id}</span>
                )}
                <span className="type-label-small text-on-surface-variant">type {a.kind}</span>
                {/* Le blob `data` (base64) n'est pas décodé — sa sémantique n'est établie par
                 * aucune source, seule sa taille est affichée. */}
                <span className="type-label-small text-on-surface-variant">{a.data_len} o. base64</span>
              </Row>
            ))}
          {kind === "teams" &&
            filteredTeams.map((t) => (
              <Row key={t.team_id} code={null} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface">{t.name ?? t.team_id}</span>
                {t.seasons.map((s) => (
                  <Badge key={s} variant="outline">
                    {s}
                  </Badge>
                ))}
              </Row>
            ))}
          {kind === "formations" &&
            filteredFormations.map((f) => (
              // Aucun nom résolvable : `formation_text.cfg.bin` n'existe pas dans cette version du
              // jeu, `noun_id`/`desc_id` restent donc des hachages bruts (cf. `nie_data::formation`).
              <Row key={f.form_id} code={null} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface">{f.form_id}</span>
                <span className="type-label-small text-on-surface-variant" title="identifiant de libellé, non résolvable dans cette version du jeu">
                  nom {f.noun_id}
                </span>
                <Badge variant="outline">{f.positions.join("-") || "aucun placement"}</Badge>
                <span className="type-label-small text-on-surface-variant">
                  att. {f.power_offense} / déf. {f.power_defense}
                </span>
              </Row>
            ))}
          {kind === "uniforms" &&
            filteredUniforms.map((u) => (
              // Clé composite : rien ne garantit l'unicité de `name_id` sur 627 lignes, la
              // tranche de modèles la lève.
              <Row key={`${u.name_id}-${u.model_start}`} code={null} selected={selectedCode} onSelect={setSelectedCode}>
                <span className="min-w-0 flex-1 truncate text-on-surface">{u.name_id}</span>
                {u.type_id != null && <Badge variant="outline">type {u.type_id}</Badge>}
                <span className="type-label-small text-on-surface-variant">
                  {u.resolved_count} / {u.model_count} modèle(s)
                </span>
                {u.fielder_model_id && (
                  <span className="type-label-small text-on-surface-variant">joueur {u.fielder_model_id}</span>
                )}
              </Row>
            ))}
          {!loading && filteredCount === 0 && (
            <p className="p-4 type-body-small text-on-surface-variant">Aucun résultat ne correspond.</p>
          )}
        </div>
      </ScrollArea>
        </>
      )}
      </div>

      {/* Éditeur de propriétés — une entité sélectionnée dans la liste ouvre TOUT ce qui s'y
       * rattache : ses fichiers (modèle, textures, sons), ses `.cfg.bin` éditables, et les
       * fonctions/adresses de `nie.exe` qui la manipulent. */}
      {kind !== "stats" && (
        <div className="flex h-full w-[340px] min-w-[340px] flex-col">
          {selectedCode ? (
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-app-line bg-app-box/60">
              <PropertyEditor code={selectedCode} className="h-full p-3" onOpenFile={onOpenFile} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-app-line px-4 text-center text-xs text-ink-faint">
              Sélectionnez une entrée pour ouvrir son éditeur de propriétés (fichiers, données,
              moteur).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Filtre insensible à la casse sur un ensemble de champs texte extraits par élément. */

