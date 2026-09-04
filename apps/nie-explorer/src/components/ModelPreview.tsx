import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const Viewport = lazy(() => import("./editor/Viewport3D").then((m) => ({ default: m.Viewport3D })));

/** Aperçu VFS utilisant le même moteur et le même assemblage que l'éditeur. */
export function ModelPreview({ path, gameDir }: { path: string; gameDir?: string }) {
  const [model, setModel] = useState<{ path: string; glbB64: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setError(null);
    api.glbBytesB64(path, gameDir).then(
      (glbB64) => { if (!cancelled) setModel({ path, glbB64 }); },
      (reason) => { if (!cancelled) setError(String(reason)); },
    );
    return () => { cancelled = true; };
  }, [path, gameDir]);
  return (
    <section aria-label="Aperçu 3D" className="shrink-0 overflow-hidden rounded-lg border border-app-line">
      <ErrorBoundary zone="Aperçu 3D" resetKeys={[path, gameDir]}>
      <Suspense fallback={<p className="p-3">Chargement du viewer 3D…</p>}>
        <Viewport
          assets={model?.path === path ? [{ key: path, glbB64: model.glbB64 }] : []}
          selectedId={null}
          notice={error ?? (!model ? "Assemblage du modèle…" : null)}
          className="h-96 w-full"
        />
      </Suspense>
      </ErrorBoundary>
      <p className="p-2 text-xs text-ink-dull">Glisser pour tourner · Molette pour zoomer · Clic droit pour déplacer la vue</p>
    </section>
  );
}
