/**
 * Le viewport de l'éditeur : **rendu Rust** d'abord, three.js en repli.
 *
 * Ce fichier est le point de bascule, et c'est délibéré : `EditorView` (1 049 lignes) importe
 * `Viewport3D` d'ici et n'a pas à savoir quel moteur l'anime. Basculer, ou revenir en arrière,
 * ne touche que ces quelques lignes.
 *
 * `nie-render3d` porte désormais les quatre capacités pour lesquelles le viewport three.js
 * survivait — grille, fil de fer, contour de sélection et gizmo (translation, rotation, échelle).
 * Le repli reste néanmoins branché : l'éditeur Rust demande WebGPU ou WebGL 2, et un navigateur
 * qui n'expose ni l'un ni l'autre n'aurait plus d'éditeur du tout. three.js y descend jusqu'à
 * WebGL 1.
 *
 * Le repli se déclenche sur `onUnavailable` — « le viewer ne se construit pas ici » — et jamais
 * sur une erreur de scène : un seul asset illisible ne doit pas faire basculer tout un
 * navigateur sur le moteur de secours.
 */
import { useCallback, useState } from "react";
import {
  Viewport3D as SharedViewport3D,
  type Viewport3DProps as SharedViewport3DProps,
  type Viewport3DServices,
} from "@nie/inacord-ui/three/Viewport3D";
import { RustSceneViewport } from "@nie/inacord-ui/shell/rust-scene-viewport.tsx";
import { createSceneViewer } from "../../../game/native-viewer";
import { b64ToBytes } from "@/lib/bytes";

export type {
  ViewportAsset,
  SceneNode,
  ViewportStats,
  GizmoMode,
  NodeTransform,
  ViewportReferenceImage,
} from "@nie/inacord-ui/three/Viewport3D";

export type Viewport3DProps = Omit<SharedViewport3DProps, "services">;
const services: Viewport3DServices = { decodeBase64: b64ToBytes };

export function Viewport3D(props: Viewport3DProps) {
  const [replier, setReplier] = useState(false);
  const surIndisponible = useCallback((raison: string) => {
    // Journalisé plutôt que tu : un repli silencieux se manifeste par des performances et des
    // capacités différentes sans que personne sache pourquoi.
    console.warn(`[éditeur] rendu Rust indisponible, repli three.js : ${raison}`);
    setReplier(true);
  }, []);

  if (replier) {
    return <SharedViewport3D {...props} services={services} />;
  }
  return (
    <RustSceneViewport
      {...props}
      services={services}
      createViewer={createSceneViewer}
      onUnavailable={surIndisponible}
    />
  );
}
