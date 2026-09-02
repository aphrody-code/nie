// Vue **Outils** — les cinq outils du wiki (`/tools`), réunis dans une seule vue à onglets.
//
// ## Pourquoi une vue à onglets et non cinq entrées de barre latérale
//
// Trois raisons mesurées, pas une préférence :
//
//  1. la barre latérale porte déjà douze entrées, et son groupe « Outils » désigne les outils DU
//     DÉPÔT (mods, RE, Viola, Live mod, Lua). Y verser cinq outils de wiki mélangerait deux
//     natures d'objet dans le même groupe ;
//  2. `AppMenu.VIEW_TABS` n'attribue un accélérateur qu'aux **neuf premières** vues (`Ctrl+1…9`,
//     `useAppMenuShortcuts` ne lit qu'un chiffre) : cinq entrées de plus rendraient muettes cinq
//     vues existantes ;
//  3. les trois outils d'équipe partagent le MÊME roster (6 166 lignes du miroir). Chargé ici,
//     une fois, il sert les trois onglets ; réparti sur cinq vues, il serait rechargé cinq fois.
//
// Le calculateur de stats n'est pas dupliqué : c'est le composant `tools/StatCalculator`, celui-là
// même que monte l'onglet « Calculateur de stats » de `GameDataView`.
import { useEffect, useMemo, useState } from "react";

import { versJoueur, type Joueur } from "@/lib/equipe";
import { useSettings } from "@/lib/settings";
import { wikiDb } from "@/lib/wikiDb";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComparatorPanel } from "@/components/tools/ComparatorPanel";
import { RandomTeamPanel } from "@/components/tools/RandomTeamPanel";
import { StatCalculator } from "@/components/tools/StatCalculator";
import { TeamBuilderPanel } from "@/components/tools/TeamBuilderPanel";
import { TranslatorPanel } from "@/components/tools/TranslatorPanel";

type Outil = "traducteur" | "stats" | "comparateur" | "aleatoire" | "equipe";

const LIBELLES: Record<Outil, string> = {
  traducteur: "Traducteur",
  stats: "Calculateur de stats",
  comparateur: "Comparateur",
  aleatoire: "Équipe aléatoire",
  equipe: "Mon équipe",
};

export function ToolsView({ onOpenSearch }: { onOpenSearch?: (query: string) => void }) {
  const settings = useSettings();
  const [outil, setOutil] = useState<Outil>("traducteur");
  const [roster, setRoster] = useState<Joueur[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  // Un seul chargement du roster pour les trois outils d'équipe. Les postes d'encadrement
  // (`Entraîneur`) sont écartés du vivier de joueurs : ils ne tiennent aucun créneau de terrain.
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
      .chargerRoster(chemin)
      .then((lignes) => {
        if (!annule) setRoster(lignes.map(versJoueur).filter((j) => j.poste !== "Entraîneur"));
        return null;
      })
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

  const onglets = useMemo(() => Object.entries(LIBELLES) as [Outil, string][], []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={outil} onValueChange={(v) => v && setOutil(v as Outil)}>
          <TabsList>
            {onglets.map(([cle, libelle]) => (
              <TabsTrigger key={cle} value={cle}>
                {libelle}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {chargement ? (
          <Badge variant="outline">chargement du roster…</Badge>
        ) : (
          <Badge variant="secondary">{roster.length.toLocaleString("fr-FR")} joueurs</Badge>
        )}
      </div>

      {erreur && (
        <Alert variant="destructive">
          <AlertTitle>Miroir wiki indisponible</AlertTitle>
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      <div className="min-h-0 flex-1">
        {outil === "traducteur" && <TranslatorPanel onOpenCode={onOpenSearch} />}
        {outil === "stats" && <StatCalculator />}
        {outil === "comparateur" && <ComparatorPanel roster={roster} />}
        {outil === "aleatoire" && <RandomTeamPanel roster={roster} />}
        {outil === "equipe" && <TeamBuilderPanel roster={roster} />}
      </div>
    </div>
  );
}
