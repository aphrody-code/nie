// Poignées de redimensionnement d'une fenêtre SANS bordure (`decorations: false`).
//
// Windows ne dessine plus de cadre : il n'y a donc plus de zone de saisie native sur les bords, et
// la fenêtre devient FIGÉE (ni élargissable, ni rétrécissable). Ces huit bandes invisibles
// rétablissent le geste en appelant `startResizeDragging(direction)` — la même primitive que le
// cadre natif utilise (`WM_NCLBUTTONDOWN`/`HTLEFT`…), donc le redimensionnement reste fait PAR
// Windows (accrochage, contraintes min/max, aperçu) et non simulé en JS.
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Recopié de `@tauri-apps/api/window` : le paquet déclare `ResizeDirection` mais ne l'exporte
 * pas (vérifié dans son `.d.ts`), donc impossible de l'importer. */
type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

/** Épaisseur de la zone de saisie, en px. 4 px = la valeur d'un cadre Windows 11 sans bordure
 * visible ; les coins sont doublés pour rester attrapables. */
const EDGE = 4;
const CORNER = 10;

const win = getCurrentWindow();

function start(direction: ResizeDirection, e: React.PointerEvent) {
  // Bouton gauche uniquement : un clic droit sur un bord doit rester un clic droit.
  if (e.button !== 0) return;
  e.preventDefault();
  win.startResizeDragging(direction).catch(() => {});
}

interface Handle {
  direction: ResizeDirection;
  style: React.CSSProperties;
  cursor: string;
}

const HANDLES: Handle[] = [
  { direction: "North", style: { top: 0, left: CORNER, right: CORNER, height: EDGE }, cursor: "ns-resize" },
  { direction: "South", style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE }, cursor: "ns-resize" },
  { direction: "West", style: { left: 0, top: CORNER, bottom: CORNER, width: EDGE }, cursor: "ew-resize" },
  { direction: "East", style: { right: 0, top: CORNER, bottom: CORNER, width: EDGE }, cursor: "ew-resize" },
  { direction: "NorthWest", style: { top: 0, left: 0, width: CORNER, height: CORNER }, cursor: "nwse-resize" },
  { direction: "NorthEast", style: { top: 0, right: 0, width: CORNER, height: CORNER }, cursor: "nesw-resize" },
  { direction: "SouthWest", style: { bottom: 0, left: 0, width: CORNER, height: CORNER }, cursor: "nesw-resize" },
  { direction: "SouthEast", style: { bottom: 0, right: 0, width: CORNER, height: CORNER }, cursor: "nwse-resize" },
];

export function WindowResizeHandles() {
  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.direction}
          // z-index au-dessus de tout le chrome de l'app (barre supérieure incluse, z-60) : un bord
          // recouvert par un panneau ne serait plus saisissable.
          className="fixed z-[100]"
          style={{ ...h.style, cursor: h.cursor }}
          onPointerDown={(e) => start(h.direction, e)}
        />
      ))}
    </>
  );
}
