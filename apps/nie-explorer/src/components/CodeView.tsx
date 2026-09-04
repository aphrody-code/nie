// Onglet « Code du dépôt » — parcourir, lire et chercher dans le code source du projet.
//
// L'application savait tout montrer du jeu et rien du dépôt qui la produit. Cette vue comble ce
// manque, et c'est par elle que le client atteint le code depuis l'application distribuée.
//
// Rien n'est réimplémenté ici : les quatre appels passent par `api.depot*` → commandes Tauri →
// `nie_explore::depot`, le MÊME moteur que `niers find`/`grep` et que le serveur MCP
// `niers-game`. Le confinement (pas de traversée hors du dépôt) et les exclusions (`data/`,
// `target/`, `var/`, `node_modules/`, `.git/`) sont appliqués côté Rust — l'interface n'a
// aucune règle de sécurité à retenir, donc aucune à oublier.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type Correspondance, type EntreeDepot, type FichierDepot } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/** Sépare les milliers — ces tailles se lisent. */
function o(n: number): string {
  return n.toLocaleString("fr-FR");
}

/** Segments cliquables du chemin courant, pour remonter d'un cran sans repartir de la racine. */
function filDAriane(chemin: string): { label: string; cible: string }[] {
  const fil = [{ label: "dépôt", cible: "" }];
  const parts = chemin.split("/").filter(Boolean);
  let acc = "";
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p;
    fil.push({ label: p, cible: acc });
  }
  return fil;
}

type Mode = "chemin" | "contenu";

export function CodeView() {
  const [dossier, setDossier] = useState("");
  const [entrees, setEntrees] = useState<EntreeDepot[]>([]);
  const [fichier, setFichier] = useState<FichierDepot | null>(null);
  const [motif, setMotif] = useState("");
  const [mode, setMode] = useState<Mode>("contenu");
  const [resultats, setResultats] = useState<Correspondance[] | string[] | null>(null);
  const [occupe, setOccupe] = useState(false);

  const ouvrirDossier = useCallback(async (cible: string) => {
    try {
      const liste = await api.depotLister(cible);
      setEntrees(liste);
      setDossier(cible);
      setResultats(null);
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  useEffect(() => {
    void ouvrirDossier("");
  }, [ouvrirDossier]);

  const ouvrirFichier = useCallback(async (chemin: string) => {
    try {
      setFichier(await api.depotLire(chemin));
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  const chercher = useCallback(async () => {
    const q = motif.trim();
    if (!q) {
      setResultats(null);
      return;
    }
    setOccupe(true);
    try {
      // La recherche part du dossier courant : c'est ce qu'on attend en ayant navigué jusque-là,
      // et cela évite de balayer tout le dépôt pour une question locale.
      const opts = { sousDossier: dossier, limite: 200 };
      setResultats(
        mode === "contenu" ? await api.depotChercher(q, opts) : await api.depotTrouver(q, opts),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setOccupe(false);
    }
  }, [motif, mode, dossier]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex items-center gap-2">
        <Input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void chercher();
          }}
          placeholder={
            mode === "contenu"
              ? "Chercher dans le contenu (expression régulière)…"
              : "Chercher un fichier par chemin…"
          }
          className="flex-1"
        />
        <Button
          variant="outline"
          onClick={() => setMode(mode === "contenu" ? "chemin" : "contenu")}
          title="Basculer entre recherche de contenu et recherche de chemin"
        >
          {mode === "contenu" ? "contenu" : "chemin"}
        </Button>
        <Button onClick={() => void chercher()} disabled={occupe}>
          {occupe ? "…" : "Chercher"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {filDAriane(dossier).map((seg, i, tout) => (
          <span key={seg.cible} className="flex items-center gap-1">
            <button
              type="button"
              className="hover:underline"
              onClick={() => void ouvrirDossier(seg.cible)}
            >
              {seg.label}
            </button>
            {i < tout.length - 1 && <span>/</span>}
          </span>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        <ScrollArea className="w-1/3 min-w-64 rounded border">
          {resultats === null ? (
            <div className="p-1">
              {entrees.map((e) => (
                <button
                  type="button"
                  key={e.chemin}
                  onClick={() => (e.dossier ? void ouvrirDossier(e.chemin) : void ouvrirFichier(e.chemin))}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent",
                    fichier?.chemin === e.chemin && "bg-accent",
                  )}
                >
                  <Icon name={e.dossier ? "folder" : "article"} size={16} />
                  <span className="flex-1 truncate">{e.nom}</span>
                  {!e.dossier && (
                    <span className="shrink-0 text-xs text-muted-foreground">{o(e.taille)}</span>
                  )}
                </button>
              ))}
              {entrees.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">Dossier vide.</p>
              )}
            </div>
          ) : (
            <div className="p-1">
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {resultats.length} résultat(s) — {mode === "contenu" ? "contenu" : "chemin"}
              </p>
              {resultats.map((r, i) =>
                typeof r === "string" ? (
                  <button
                    type="button"
                    key={r}
                    onClick={() => void ouvrirFichier(r)}
                    className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  >
                    {r}
                  </button>
                ) : (
                  <button
                    type="button"
                    key={`${r.chemin}:${r.ligne}:${i}`}
                    onClick={() => void ouvrirFichier(r.chemin)}
                    className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
                  >
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.chemin}:{r.ligne}
                    </span>
                    <span className="block truncate font-mono text-xs">{r.texte}</span>
                  </button>
                ),
              )}
              {resultats.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">Aucun résultat.</p>
              )}
            </div>
          )}
        </ScrollArea>

        <ScrollArea className="min-w-0 flex-1 rounded border">
          {fichier === null ? (
            <p className="p-4 text-sm text-muted-foreground">
              Choisir un fichier à gauche, ou lancer une recherche.
            </p>
          ) : (
            <div className="min-w-0 p-2">
              <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b pb-2">
                <span className="font-mono text-sm">{fichier.chemin}</span>
                <span className="text-xs text-muted-foreground">
                  {o(fichier.taille)} octets
                  {fichier.tronque && " — tronqué"}
                </span>
              </div>
              {fichier.contenu === null ? (
                <p className="text-sm text-muted-foreground">
                  {fichier.note ?? "Contenu non disponible."}
                </p>
              ) : (
                <pre className="overflow-x-auto whitespace-pre font-mono text-xs">
                  {fichier.contenu}
                </pre>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
