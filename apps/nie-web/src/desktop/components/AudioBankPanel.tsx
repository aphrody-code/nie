import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, type AudioBank, type AudioCue } from "@/lib/api";
import { useSettings } from "@nie/inacord-ui/lib/settings";
import { humanSize } from "@/lib/bytes";
import { Button } from "@nie/inacord-ui/components/ui/button";
import { Input } from "@nie/inacord-ui/components/ui/input";
import { Badge } from "@nie/inacord-ui/components/ui/badge";

/** Pistes montées d'emblée — une banque en déclare jusqu'à 1 512. */
const PAGE = 80;

/** Durée annoncée par la banque, en `m:ss`. `0` = inconnue, on n'invente rien. */
function duree(ms: number): string {
  if (ms <= 0) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Catalogue jouable d'une banque audio Criware (`.acb` / `.awb`).
 *
 * L'aperçu audio du panneau de détail décode UNE piste par fichier — la plus volumineuse. Or une
 * banque n'est pas un son : `waza_stream.acb` en décrit 1 512, et les octets vivent dans un AWB
 * frère qui atteint 1,25 Gio. Toutes les autres pistes étaient inatteignables depuis
 * l'application.
 *
 * Le catalogue vient de l'ACB seul (noms, durées, codec, fréquence) : il ne charge pas l'AWB. Une
 * piste n'est décodée qu'au clic, et elle est désignée par son **cue-id AFS2**, jamais par son
 * rang dans la banque — les deux coïncident souvent, jamais toujours, et les confondre fait jouer
 * un autre son sans lever la moindre erreur.
 */
export function AudioBankPanel({ path }: { path: string }) {
  const settings = useSettings();
  const [bank, setBank] = useState<AudioBank | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filtre, setFiltre] = useState("");
  const [visibles, setVisibles] = useState(PAGE);
  /** Piste en cours de lecture (cue-id AFS2), `null` = aucune. */
  const [joue, setJoue] = useState<{ id: number; url: string } | null>(null);
  const [chargement, setChargement] = useState<number | null>(null);
  const cueGeneration = useRef(0);

  useEffect(() => {
    cueGeneration.current++;
    setBank(null);
    setError(null);
    setJoue(null);
    setChargement(null);
    setFiltre("");
    setVisibles(PAGE);
    setLoading(true);
    let vivant = true;
    api
      .audioCues(path, settings.gameDir)
      .then((b) => vivant && setBank(b))
      .catch((e) => vivant && setError(String(e)))
      .finally(() => vivant && setLoading(false));
    return () => {
      vivant = false;
      cueGeneration.current++;
    };
  }, [path, settings.gameDir]);

  const filtrees = useMemo(() => {
    const q = filtre.trim().toLowerCase();
    const cues = bank?.cues ?? [];
    return q ? cues.filter((c) => c.name.toLowerCase().includes(q) || String(c.awb_id ?? "").includes(q)) : cues;
  }, [bank, filtre]);
  const affichees = useMemo(() => filtrees.slice(0, visibles), [filtrees, visibles]);
  const selectedIndex = joue ? filtrees.findIndex((cue) => cue.awb_id === joue.id) : -1;
  const previousIndex = selectedIndex > 0
    ? filtrees.findLastIndex((cue, index) => index < selectedIndex && cue.awb_id !== null)
    : -1;
  const nextIndex = selectedIndex >= 0
    ? filtrees.findIndex((cue, index) => index > selectedIndex && cue.awb_id !== null)
    : -1;
  const selectedCue = selectedIndex >= 0 ? filtrees[selectedIndex] ?? null : null;

  async function jouer(cue: AudioCue) {
    if (cue.awb_id === null) return;
    const generation = ++cueGeneration.current;
    setChargement(cue.awb_id);
    try {
      const b64 = await api.audioCueWavB64(path, cue.awb_id, settings.gameDir);
      if (generation !== cueGeneration.current) return;
      setJoue({ id: cue.awb_id, url: `data:audio/wav;base64,${b64}` });
	  const filteredIndex = filtrees.indexOf(cue);
	  if (filteredIndex >= 0) setVisibles((current) => Math.max(current, filteredIndex + 1));
    } catch (e) {
      if (generation === cueGeneration.current) toast.error(String(e));
    } finally {
      if (generation === cueGeneration.current) setChargement(null);
    }
  }

  async function exporter(cue: AudioCue) {
    if (cue.awb_id === null) return;
    try {
      const dest = await save({ defaultPath: cue.filename, filters: [{ name: "WAV", extensions: ["wav"] }] });
      if (!dest) return;
      const b64 = await api.audioCueWavB64(path, cue.awb_id, settings.gameDir);
      await api.saveBytesB64(dest, b64);
      toast.success(`${cue.filename} écrit`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  if (loading) return <p className="type-body-small text-on-surface-variant">Lecture de la banque…</p>;
  if (error) return <p className="type-body-small text-error">{error}</p>;
  if (!bank) return null;
  if (bank.cues.length === 0)
    return <p className="type-body-small text-on-surface-variant">Cette banque ne déclare aucune piste.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          {bank.cues.length.toLocaleString("fr-FR")} piste{bank.cues.length > 1 ? "s" : ""}
        </Badge>
        {/* D'où viennent les octets : le fichier lui-même, l'AWB embarqué, ou un frère du VFS. */}
        <span className="truncate type-label-small text-on-surface-variant">
          {bank.source === "self"
            ? "banque autonome"
            : bank.source === "embedded"
              ? "AWB embarqué"
              : bank.source === "aucune"
                ? "aucun AWB atteignable — pistes listées, non jouables"
                : `AWB externe : ${bank.source}`}
        </span>
        {bank.cues.length > 8 && (
          <Input
            value={filtre}
            onChange={(e) => {
              setFiltre(e.target.value);
              setVisibles(PAGE);
            }}
            placeholder="Filtrer par nom ou cue-id…"
            className="h-7 flex-1"
          />
        )}
      </div>

      {joue && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Navigation des pistes">
          <Button size="sm" variant="outline" disabled={previousIndex < 0 || chargement !== null}
            onClick={() => previousIndex >= 0 && jouer(filtrees[previousIndex]!) }>
            Précédente
          </Button>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio src={joue.url} controls autoPlay className="min-w-0 flex-1" />
          <Button size="sm" variant="outline" disabled={nextIndex < 0 || chargement !== null}
            onClick={() => nextIndex >= 0 && jouer(filtrees[nextIndex]!) }>
            Suivante
          </Button>
          {selectedCue ? (
            <Button size="sm" variant="outline" onClick={() => exporter(selectedCue)}>
              Télécharger WAV
            </Button>
          ) : null}
        </div>
      )}

      <div className="divide-y divide-app-line rounded-lg border border-app-line">
        {affichees.map((c, i) => {
          const jouable = bank.playable && c.awb_id !== null;
          return (
            <div
              key={`${c.awb_id ?? "x"}-${i}`}
              className={`flex items-center gap-2 px-2 py-1 ${joue?.id === c.awb_id ? "bg-secondary-container" : ""}`}
            >
              <Button
                size="sm"
                variant="ghost"
                disabled={!jouable || chargement !== null}
                onClick={() => jouer(c)}
                title={jouable ? "Décoder et jouer cette piste" : "Piste sans forme d'onde adressable"}
              >
                {chargement === c.awb_id ? "…" : "▶"}
              </Button>
              <span className="flex-1 truncate type-body-small text-on-surface">
                {c.name || <span className="text-on-surface-variant">(sans nom)</span>}
              </span>
              {c.codec && <span className="type-label-small text-on-surface-variant">{c.codec}</span>}
              {c.sample_rate !== null && (
                <span className="type-label-small text-on-surface-variant">{(c.sample_rate / 1000).toFixed(1)} kHz</span>
              )}
              {duree(c.length_ms) && <span className="tabular-nums type-label-small text-on-surface-variant">{duree(c.length_ms)}</span>}
              {c.size !== null && <span className="tabular-nums type-label-small text-on-surface-variant">{humanSize(c.size)}</span>}
              <Button size="sm" variant="ghost" disabled={!jouable} onClick={() => exporter(c)} title="Exporter cette piste en WAV">
                ⬇
              </Button>
            </div>
          );
        })}
      </div>

      {filtrees.length > visibles && (
        <Button size="sm" variant="outline" onClick={() => setVisibles((n) => n + PAGE)}>
          Afficher {Math.min(PAGE, filtrees.length - visibles)} de plus ({filtrees.length - visibles} restantes)
        </Button>
      )}
    </div>
  );
}
