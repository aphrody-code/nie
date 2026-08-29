// Onglet « Forge » — la part de `nie.exe` que le dépôt produit **réellement**, à l'octet.
//
// Le projet ne vise pas seulement à rejouer le jeu : il vise à produire le binaire. La forge est
// le juge — `nie-forge build` échoue si le fichier produit n'est pas byte-identique à la
// référence, et la métrique de progression est la masse d'octets réellement générés.
//
// Cette vue relit les mêmes artefacts que la CLI à chaque appel (`var/forge/cover.json`,
// `forge/registry.json`, `forge/asm/*.s`) : rien n'est figé, ce qui est affiché est l'état du
// disque. Le second panneau est la **liste de travail** — ce qui empêche encore de produire,
// trié par octets bloqués. C'est ce diagnostic chiffré, et non l'intuition, qui guide
// l'élargissement du dialecte assembleur.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type ForgeBlocker, type ForgeReport } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Sépare les milliers à la française — ces nombres se lisent, ils ne se survolent pas. */
function o(n: number): string {
  return n.toLocaleString("fr-FR");
}

export function ReForgeView() {
  const [report, setReport] = useState<ForgeReport | null>(null);
  const [blockers, setBlockers] = useState<ForgeBlocker[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setReport(await api.forgeReport());
    } catch (e) {
      setError(String(e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadBlockers() {
    setScanning(true);
    try {
      setBlockers(await api.forgeBlockers(undefined, 25));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (error) {
    return (
      <div className="p-4">
        <Alert>
          <AlertTitle>Forge indisponible</AlertTitle>
          <AlertDescription>
            {error}
            <div className="mt-2 text-xs opacity-70">
              Le recouvrement se produit avec <code>nie-forge split --exe nie.exe --db var/niers.sqlite</code>,
              puis <code>nie-forge lift</code>.
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-1">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? "Mesure…" : "Recalculer"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void loadBlockers()} disabled={scanning}>
            {scanning ? "Analyse de .text…" : "Ce qui bloque"}
          </Button>
          {report ? <span className="truncate text-xs opacity-60">{report.root}</span> : null}
        </div>

        {report ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded border p-3">
                <div className="text-xs uppercase opacity-60">Fichier produit</div>
                <div className="text-2xl font-semibold tabular-nums">{(report.produced_pct ?? 0).toFixed(3)} %</div>
                <div className="text-xs opacity-70">
                  {o(report.produced_bytes)} / {o(report.total_bytes)} octets
                </div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs uppercase opacity-60">.text produit</div>
                <div className="text-2xl font-semibold tabular-nums">{(report.code_pct ?? 0).toFixed(3)} %</div>
                <div className="text-xs opacity-70">sur {o(report.code_bytes)} octets de code</div>
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs uppercase opacity-60">Par source</div>
              <table className="w-full text-sm">
                <thead className="text-xs opacity-60">
                  <tr>
                    <th className="text-left font-normal">source</th>
                    <th className="text-right font-normal">unités</th>
                    <th className="text-right font-normal">octets</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>en-têtes PE recalculés (nie-pe)</td>
                    <td className="text-right tabular-nums">{o(report.emitted.units)}</td>
                    <td className="text-right tabular-nums">{o(report.emitted.bytes)}</td>
                  </tr>
                  <tr>
                    <td>corps réassemblés (nie-asm)</td>
                    <td className="text-right tabular-nums">{o(report.assembled.units)}</td>
                    <td className="text-right tabular-nums">{o(report.assembled.bytes)}</td>
                  </tr>
                  <tr>
                    <td>codegen Rust coïncidant</td>
                    <td className="text-right tabular-nums">{o(report.matched_bytes.units)}</td>
                    <td className="text-right tabular-nums">{o(report.matched_bytes.bytes)}</td>
                  </tr>
                  <tr className="opacity-60">
                    <td>validé sémantiquement — jamais compté comme produit</td>
                    <td className="text-right tabular-nums">{o(report.matched_semantic.units)}</td>
                    <td className="text-right tabular-nums">{o(report.matched_semantic.bytes)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-1 text-xs opacity-60">
                {o(report.total_units)} unités au recouvrement, dont {o(report.functions)} fonctions.
                {report.orphan_entries > 0
                  ? ` ${o(report.orphan_entries)} entrée(s) de registre sans unité correspondante.`
                  : null}
              </div>
            </div>

            {blockers.length > 0 ? (
              <div>
                <div className="mb-1 text-xs uppercase opacity-60">
                  Ce qui bloque encore — la première ligne est la prochaine cible
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs opacity-60">
                    <tr>
                      <th className="text-left font-normal">cause</th>
                      <th className="text-right font-normal">unités</th>
                      <th className="text-right font-normal">octets</th>
                      <th className="text-left font-normal">exemple</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blockers.map((b) => (
                      <tr key={b.cause}>
                        <td className="font-mono">{b.cause}</td>
                        <td className="text-right tabular-nums">{o(b.units)}</td>
                        <td className="text-right tabular-nums">{o(b.bytes)}</td>
                        <td className="max-w-[24rem] truncate font-mono text-xs opacity-70" title={b.sample}>
                          {b.sample}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </ScrollArea>
  );
}
