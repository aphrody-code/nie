import { useCallback, useMemo } from "react";
import { RustModelViewport } from "@niers/inacord-ui/shell/rust-model-viewport";
import { api } from "@/lib/api";
import { b64ToBytes } from "@/lib/bytes";
import { createOpaqueNativeViewer } from "../../game/native-viewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";

/**
 * Surface 3D unique de l'Explorer.
 *
 * Le chargeur VFS par défaut et le chargeur CPK brut ne diffèrent que par la provenance du GLB :
 * ils aboutissent tous deux au même viewport temps réel, avec les mêmes contrôles de caméra.
 *
 * Ce viewport est celui de TOUT le reste du dépôt — `/avatar`, `/models-3d` et la visionneuse du
 * jeu passent par `RustModelViewport`, donc par `nie-render3d` en WebGPU, par son backend WebGL 2
 * dans `nie-viewer-web`, ou par le rastériseur CPU, dans cet ordre. Cette page chargeait à la
 * place le viewport three.js de l'éditeur, qui sait faire bien plus (plusieurs assets, outliner,
 * gizmos, sélection) et dont rien n'était utilisé ici : `selectedId` valait toujours `null` et
 * aucun gizmo n'était proposé. Deux moteurs de rendu pour un aperçu à un modèle, c'était le
 * doublon, pas la fonctionnalité.
 */
export function ModelPreview({
  path,
  gameDir,
  loadGlb,
}: {
  path: string;
  gameDir?: string;
  loadGlb?: () => Promise<string>;
}) {
  // `loadBytes` est une dépendance d'effet dans le viewport : la recréer à chaque rendu
  // rechargerait le modèle en boucle.
  const loadBytes = useCallback(async () => {
    const glbB64 = await (loadGlb ? loadGlb() : api.glbBytesB64(path, gameDir));
    return b64ToBytes(glbB64);
  }, [path, gameDir, loadGlb]);
  const camera = useMemo(() => ({ yaw: 0.6, pitch: 0.2, distance: 3.1 }), []);
  return (
    <section aria-label="Aperçu 3D" className="shrink-0 overflow-hidden rounded-lg border border-app-line">
      <ErrorBoundary zone="Aperçu 3D" resetKeys={[path, gameDir]}>
        <div className="h-96 w-full">
          <RustModelViewport
            url={path}
            loadBytes={loadBytes}
            createViewer={createOpaqueNativeViewer}
            label={`Aperçu 3D de ${path}`}
            initialCamera={camera}
            loadingFallback={<p className="p-3">Assemblage du modèle…</p>}
          />
        </div>
      </ErrorBoundary>
      <p className="p-2 text-xs text-ink-dull">Glisser pour tourner · Molette pour zoomer</p>
    </section>
  );
}
