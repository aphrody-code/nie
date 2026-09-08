/** Compatibility binding: the shared owner retains every viewer/editor interaction. */
import {
  Viewport3D as SharedViewport3D,
  type Viewport3DProps as SharedViewport3DProps,
  type Viewport3DServices,
} from "@niers/inacord-ui/three/Viewport3D";
import { b64ToBytes } from "@/lib/bytes";

export type {
  ViewportAsset,
  SceneNode,
  ViewportStats,
  GizmoMode,
  NodeTransform,
} from "@niers/inacord-ui/three/Viewport3D";

export type Viewport3DProps = Omit<SharedViewport3DProps, "services">;
const services: Viewport3DServices = { decodeBase64: b64ToBytes };

export function Viewport3D(props: Viewport3DProps) {
  return <SharedViewport3D {...props} services={services} />;
}
