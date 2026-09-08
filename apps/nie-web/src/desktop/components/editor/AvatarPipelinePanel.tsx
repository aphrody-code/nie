// Atelier de convergence : il ne fabrique ni modèle ni sprite. Le catalogue est l'export de
// `niers avatar export`, le GLB vient de `nie-model-serve`, et le viewport parent charge cet
// artefact exactement comme n'importe quel GLB VFS.
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { cn } from "@niers/inacord-ui/lib/utils";
import { INITIAL_AVATAR_STATE, type AvatarCatalog as Catalogue } from "@niers/inacord-ui/avatar/contract";
import { avatarModelUrl } from "@niers/inacord-ui/avatar/request";

function isCatalogue(value: unknown): value is Catalogue {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Catalogue>;
  return Array.isArray(c.categories) && !!c.modelesDeBase && Array.isArray(c.modelesDeBase.morphologies);
}

export function AvatarPipelinePanel({
  baseUrl,
  onGlb,
}: {
  baseUrl: string;
  onGlb: (glbB64: string) => void;
}) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [morpho, setMorpho] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.modelServiceAvatarCatalog(baseUrl).then((raw) => {
      if (cancelled) return;
      if (!isCatalogue(raw)) throw new Error("le catalogue avatar ne respecte pas le contrat attendu");
      setCatalogue(raw);
      setChoices({});
      setMorpho(0);
    }).catch((e) => !cancelled && setError(String(e))).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; requestId.current++; };
  }, [baseUrl]);

  const build = async () => {
    if (!catalogue) return;
    const request = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const composition = await api.resolveAvatarComposition(catalogue, {
        ...INITIAL_AVATAR_STATE,
        selections: choices,
        morphology: morpho,
        gender: catalogue.modelesDeBase.morphologies[morpho] === "female" ? 1 : 0,
      });
      if (request !== requestId.current) return;
      const path = avatarModelUrl(composition, "").replace(/^\//, "");
      const glb = await api.modelServiceAvatarGlbB64(baseUrl, path);
      if (request === requestId.current) onGlb(glb);
    } catch (error) {
      if (request === requestId.current) setError(String(error));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  };

  if (loading && !catalogue) return <p className="px-3 py-2 text-tiny text-ink-faint">Chargement du catalogue avatar réel…</p>;
  if (!catalogue) return <p className="px-3 py-2 text-tiny text-status-error">Pipeline avatar indisponible : {error ?? "catalogue absent"}</p>;
  return (
    <section className="flex min-h-0 shrink-0 items-center gap-2 overflow-x-auto border-b border-app-line bg-app-dark-box px-2 py-1.5" aria-label="Assemblage avatar">
      <strong className="shrink-0 text-tiny text-ink">Avatar assemblé</strong>
      <select className="h-7 rounded border border-app-line bg-app-box px-1 text-tiny text-ink" value={morpho} onChange={(e) => setMorpho(Number(e.target.value))}>
        {catalogue.modelesDeBase.morphologies.map((name, index) => <option key={name} value={index}>{name}</option>)}
      </select>
      {catalogue.categories.filter((c) => c.parts.length && c.faceSettingType >= 3 && c.faceSettingType <= 14).map((category) => (
        <select key={category.faceSettingType} className="h-7 max-w-28 rounded border border-app-line bg-app-box px-1 text-tiny text-ink" value={choices[category.faceSettingType] ?? category.parts[0]?.id ?? ""}
          title={category.prefixe || `catégorie ${category.faceSettingType}`}
          onChange={(e) => setChoices((old) => ({ ...old, [category.faceSettingType]: e.target.value }))}>
          {category.parts.map((part, index) => <option key={part.id} value={part.id}>{part.resource || `${category.prefixe} ${index + 1}`}</option>)}
        </select>
      ))}
      <button type="button" className={cn("h-7 shrink-0 rounded px-2 text-tiny font-medium", "bg-accent text-white hover:brightness-110")}
        disabled={loading} onClick={() => void build()}>{loading ? "Assemblage…" : "Assembler dans la scène"}</button>
      {error && <span className="max-w-80 truncate text-tiny text-status-error" title={error}>{error}</span>}
    </section>
  );
}
