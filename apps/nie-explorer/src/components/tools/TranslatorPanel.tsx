// **Traducteur** — dictionnaire de noms FR / EN / JA / romaji des entités du jeu.
//
// Portage de `apps/azalee/components/tools/TranslatorClient.tsx` (454 lignes) + de la *server
// action* `app/actions/translate.ts` (686 lignes) qui l'alimentait. Le scoring — normalisation
// accent-insensible, correspondance multi-mots dans le désordre, Levenshtein — est repris tel
// quel dans `lib/traduction.ts` ; ce fichier n'est que la surface.
//
// Ce qui change, et c'est structurel : le web faisait un ALLER-RETOUR SERVEUR par frappe (300 ms
// de debounce, six requêtes PostgREST `ilike` en parallèle, puis un re-scoring en JS des lignes
// ramenées). Ici l'index complet — ~9 500 noms des six tables du miroir — est chargé UNE FOIS et
// la recherche est locale. Conséquence directe : le romaji devient réellement cherchable, alors
// que le web ne pouvait le scorer que sur les lignes qu'un `ilike` avait déjà attrapées par un
// autre champ (aucune colonne `name_roma` n'existe).
//
// Ce qui n'est PAS porté : le glossaire local `data/glossary.json` que la *server action* lisait
// par `node:fs`. C'est un fichier du dépôt, pas de l'installation du jeu ; l'application de
// bureau n'y a aucun accès garanti et la portée `fs:scope` de Tauri ne couvre que `$APPDATA`.
import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

import {
  LIBELLES_TYPE,
  chercher,
  type EntreeNoms,
  type ResultatTraduction,
  type TypeEntite,
} from "@/lib/traduction";
import { useSettings } from "@/lib/settings";
import { wikiDb } from "@/lib/wikiDb";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Filtres de type, dans l'ordre des pastilles. `null` = tous. */
const TYPES: (TypeEntite | null)[] = [
  null,
  "chara",
  "waza",
  "objet",
  "tactique",
  "equipe",
  "keshin",
  "totem",
];

/** Les quatre lignes de la fiche de traduction. */
const LANGUES: { cle: keyof Pick<EntreeNoms, "nomFr" | "nomEn" | "nomJa" | "romaji">; code: string; libelle: string }[] = [
  { cle: "nomFr", code: "FR", libelle: "Français" },
  { cle: "nomEn", code: "EN", libelle: "Anglais" },
  { cle: "nomJa", code: "JA", libelle: "Japonais" },
  { cle: "romaji", code: "ROMA", libelle: "Romaji" },
];

/** Copie un nom dans le presse-papiers — hors du composant : elle ne capture rien de son etat. */
async function copier(texte: string) {
  try {
    await writeText(texte);
    toast.success(`Copié : ${texte}`);
  } catch (e) {
    toast.error(String(e));
  }
}

export function TranslatorPanel({ onOpenCode }: { onOpenCode?: (code: string) => void }) {
  const settings = useSettings();
  const [index, setIndex] = useState<EntreeNoms[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [requete, setRequete] = useState("");
  const [type, setType] = useState<TypeEntite | null>(null);
  const [choisi, setChoisi] = useState<ResultatTraduction | null>(null);

  useEffect(() => {
    const chemin = settings.wikiDb.trim();
    if (!chemin) {
      setChargement(false);
      setErreur(
        "Aucun miroir wiki configuré. Paramètres → Base du wiki (fichier `supabase-*.sqlite`).",
      );
      return;
    }
    let annule = false;
    setChargement(true);
    setErreur(null);
    wikiDb
      .chargerIndexNoms(chemin)
      .then((lignes) => (annule ? null : setIndex(lignes)))
      .catch((e) => {
        if (!annule) setErreur(String(e));
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [settings.wikiDb]);

  const resultats = useMemo(
    () => chercher(index, requete, type),
    [index, requete, type],
  );

  // La sélection suit la recherche : le premier résultat est affiché d'office, comme sur le wiki.
  useEffect(() => {
    setChoisi(resultats[0] ?? null);
  }, [resultats]);

  const approchant = resultats.length > 0 && resultats.every((r) => r.approchant);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-80"
          placeholder="Un nom en FR, EN, JA ou romaji (Mark Evans, Fire Tornado, 円堂, endou…)"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
        />
        <Badge variant="secondary">{index.length.toLocaleString("fr-FR")} noms indexés</Badge>
        {approchant && <Badge variant="outline">résultats approchants</Badge>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <button
            key={t ?? "tous"}
            type="button"
            aria-pressed={type === t}
            className={`rounded-full px-3 py-1 type-label-medium ${
              type === t ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
            }`}
            onClick={() => setType(t)}
          >
            {t ? LIBELLES_TYPE[t] : "Tous"}
          </button>
        ))}
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertTitle>Index indisponible</AlertTitle>
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_minmax(280px,0.8fr)] gap-3">
        <ScrollArea className="min-h-0 rounded-2xl border border-app-line bg-app-dark-box">
          <div className="divide-y divide-app-line">
            {resultats.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                type="button"
                className={`state-layer flex w-full items-center gap-2 px-3 py-2 text-left type-body-medium ${
                  choisi?.id === r.id && choisi.type === r.type
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface"
                }`}
                onClick={() => setChoisi(r)}
              >
                <Badge variant="outline" className="shrink-0">
                  {LIBELLES_TYPE[r.type]}
                </Badge>
                <span className="min-w-0 flex-1 truncate">
                  {r.nomFr || r.nomEn || r.nomJa || "—"}
                </span>
                {r.nomEn && r.nomEn !== r.nomFr && (
                  <span className="hidden min-w-0 max-w-[40%] truncate type-label-small text-on-surface-variant sm:inline">
                    {r.nomEn}
                  </span>
                )}
              </button>
            ))}
            {!chargement && requete.trim().length >= 2 && resultats.length === 0 && (
              <p className="p-4 type-body-small text-on-surface-variant">
                Rien pour « {requete.trim()} ». La recherche tolère les fautes et les accents :
                essayez une autre langue, ou retirez le filtre de type.
              </p>
            )}
            {requete.trim().length < 2 && (
              <p className="p-4 type-body-small text-on-surface-variant">
                {chargement ? "chargement de l'index…" : "Saisissez au moins deux caractères."}
              </p>
            )}
          </div>
        </ScrollArea>

        <div className="flex min-h-0 flex-col gap-2 rounded-2xl border border-app-line bg-app-dark-box p-4">
          {!choisi ? (
            <p className="type-body-medium text-on-surface-variant">
              Sélectionnez un résultat pour voir sa fiche.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{LIBELLES_TYPE[choisi.type]}</Badge>
                {choisi.approchant && <Badge variant="outline">approchant</Badge>}
                <span className="ml-auto tabular-nums type-label-small text-on-surface-variant">
                  score {choisi.score.toFixed(2)}
                </span>
              </div>

              {LANGUES.map(({ cle, code, libelle }) => {
                const valeur = choisi[cle];
                return (
                  <div
                    key={code}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-app-hover"
                  >
                    <span className="w-12 shrink-0 rounded bg-surface-container px-1.5 py-0.5 text-center type-label-small text-on-surface-variant">
                      {code}
                    </span>
                    {valeur ? (
                      <>
                        <span
                          className={`min-w-0 flex-1 truncate select-all ${
                            code === "JA"
                              ? "type-title-small"
                              : code === "ROMA"
                                ? "type-body-small italic text-on-surface-variant"
                                : "type-body-medium text-on-surface"
                          }`}
                        >
                          {valeur}
                        </span>
                        <button
                          type="button"
                          aria-label={`Copier le nom ${libelle}`}
                          className="state-layer shrink-0 rounded-full p-1 text-on-surface-variant"
                          onClick={() => copier(valeur)}
                        >
                          <Icon name="content_copy" size={14} />
                        </button>
                      </>
                    ) : (
                      <span className="type-body-small italic text-on-surface-variant/50">
                        non renseigné
                      </span>
                    )}
                  </div>
                );
              })}

              <div className="mt-auto space-y-1 border-t border-app-line pt-2">
                <p className="type-label-small text-on-surface-variant">
                  identifiant <span className="select-all text-on-surface">{choisi.id}</span>
                </p>
                {choisi.code && (
                  <div className="flex items-center gap-2">
                    <p className="type-label-small text-on-surface-variant">
                      code interne <span className="select-all text-on-surface">{choisi.code}</span>
                    </p>
                    {onOpenCode && (
                      // Ce que le wiki ne peut pas faire : passer du NOM aux FICHIERS. Le code
                      // interne est le basename VFS (cf. `vfsIndexDb.codeOf`) — la Recherche le
                      // retrouve dans les 255 308 entrées montées.
                      <button
                        type="button"
                        className="state-layer rounded-md px-2 py-0.5 type-label-small text-accent"
                        onClick={() => onOpenCode(choisi.code!)}
                      >
                        <Icon name="search" size={13} /> ses fichiers
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
