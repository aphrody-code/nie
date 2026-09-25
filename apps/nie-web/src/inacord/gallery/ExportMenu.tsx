/**
 * « Télécharger / Convertir… » — le choix du format de sortie d'UN fichier du VFS.
 *
 * Le composant ne sait rien convertir lui-même et ne devine aucun format : il demande à l'hôte
 * ce qu'il sait produire pour ce chemin-là (`listFormats`), puis lui redonne le format choisi
 * (`download`). C'est le serveur qui décide — la même texture `.g4tx` accepte dix sorties,
 * un `.usm` n'en accepte pas les mêmes, et une liste écrite ici mentirait sur la moitié du corpus.
 *
 * Les formats INDISPONIBLES restent affichés, désactivés, avec la raison que l'hôte donne.
 * Les masquer rendrait une liste courte impossible à distinguer d'une liste complète, et la
 * question « pourquoi pas celui-là ? » n'aurait plus de réponse à l'écran.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExportFormat } from "./contracts";
import { Icon } from "@nie/inacord-ui/components/ui/Icon";

export interface ExportMenuProps {
  /** Chemin VFS verbatim du fichier — jamais reconstruit à partir d'un nom affiché. */
  path: string;
  /** Absent = cet hôte ne publie pas de formats ; le bouton le dit au lieu de s'ouvrir sur rien. */
  listFormats?: (path: string) => Promise<ExportFormat[]>;
  download?: (path: string, format: ExportFormat) => Promise<void>;
  /** Libellé du déclencheur, pour les surfaces qui ont leur propre vocabulaire. */
  label?: string;
  className?: string;
}

/** Ce qu'on affiche quand l'hôte n'a ni liste de formats ni téléchargement. */
const SANS_HOTE = "Cet hôte ne publie pas de conversion pour ce fichier.";

export function ExportMenu({ path, listFormats, download, label = "Télécharger / Convertir…", className }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [formats, setFormats] = useState<ExportFormat[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const supported = Boolean(listFormats && download);
  // Le chemin décide du contenu du menu. Le mémoriser évite de redemander la même liste à
  // chaque ouverture, et de servir celle du fichier PRÉCÉDENT quand la visionneuse change d'image.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setFormats(null);
    setError(null);
    loadedFor.current = null;
  }, [path]);

  const charger = useCallback(() => {
    if (!listFormats || loadedFor.current === path) return;
    loadedFor.current = path;
    setLoading(true);
    setError(null);
    listFormats(path)
      .then((liste) => { setFormats(liste); return null; })
      .catch((e) => {
        // Une liste non chargée doit pouvoir être redemandée : on relâche la mémoire du chemin.
        loadedFor.current = null;
        setError(String(e));
      })
      .finally(() => setLoading(false));
  }, [listFormats, path]);

  const choisir = useCallback(
    (format: ExportFormat) => {
      if (!download) return;
      setBusy(format.id);
      setError(null);
      download(path, format)
        .then(() => { setOpen(false); return null; })
        .catch((e) => setError(String(e)))
        .finally(() => setBusy(null));
    },
    [download, path],
  );

  if (!supported) {
    return (
      <span className={className} title={SANS_HOTE}>
        <button type="button" disabled className="state-layer rounded-md px-2 py-1 type-label-medium text-on-surface-variant opacity-50">
          <Icon name="download" size={16} /> {label}
        </button>
        {/* La raison est LUE, pas cachée derrière une infobulle : un bouton grisé sans explication
          se lit comme une panne. */}
      <span className="type-label-small text-on-surface-variant">{SANS_HOTE}</span>
      </span>
    );
  }

  return (
    <span className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        className="state-layer rounded-md px-2 py-1 type-label-medium text-on-surface-variant"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) charger();
        }}
      >
        <Icon name="download" size={16} /> {label}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Formats de sortie"
          className="absolute right-0 z-50 mt-1 max-h-80 w-72 overflow-auto rounded-xl border border-app-line bg-app p-1 shadow-lg"
        >
          {loading && <p className="p-2 type-body-small text-on-surface-variant">Lecture des formats…</p>}
          {error && <p role="alert" className="p-2 type-body-small text-error">{error}</p>}
          {formats?.length === 0 && !loading && (
            <p className="p-2 type-body-small text-on-surface-variant">
              Aucun format de sortie déclaré pour ce fichier.
            </p>
          )}
          {formats?.map((format) => (
            <button
              key={format.id}
              type="button"
              role="menuitem"
              disabled={!format.available || busy !== null}
              title={format.available ? format.fileName : format.unavailableReason ?? undefined}
              className="state-layer flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left type-label-medium text-on-surface disabled:opacity-50"
              onClick={() => choisir(format)}
            >
              <span>
                {format.label}
                {busy === format.id ? " — en cours…" : ""}
              </span>
              <span className="type-label-small text-on-surface-variant">
                {/* La perte est une propriété du format, pas un avis : le serveur la déclare. */}
                {format.raw ? "fichier d’origine" : format.lossless ? "sans perte" : "avec perte"}
                {" · "}
                {format.fileName}
              </span>
              {!format.available && format.unavailableReason && (
                <span className="type-label-small text-error">{format.unavailableReason}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
