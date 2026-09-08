/** Desktop binding for the shared gallery; native dialogs and conversions stay here. */
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { GalleryView as SharedGalleryView } from "@niers/inacord-ui/gallery/GalleryView";
import type { GalleryServices } from "@niers/inacord-ui/gallery/contracts";
import { api } from "@/lib/api";
import { humanSize } from "@/lib/bytes";
import { useMemo } from "react";
import { useSettings } from "@niers/inacord-ui/lib/settings";
import { wikiDb } from "@/lib/wikiDb";

const services: GalleryServices = {
  ls: api.ls,
  findPaged: api.findPaged,
  gameDataGallery: api.gameDataGallery,
  texturePngB64: api.texturePngB64,
  formatBytes: humanSize,
  async exportPng(path, gameDir) {
    try {
      const name = await api.exportDefaultName(path, "png");
      const destination = await save({ defaultPath: name });
      if (!destination) return;
      const written = await api.exportAs(path, destination, "png", gameDir);
      toast.success(`${humanSize(written)} écrits → ${destination}`);
    } catch (error) {
      toast.error(String(error));
    }
  },
};

export function GalleryView(props: { onOpenFile?: (path: string) => void }) {
  const { wikiDb: nameSource } = useSettings();
  const galleryServices = useMemo(() => ({ ...services, nameSource, resolveNames: wikiDb.resolveManyByCode }), [nameSource]);
  return <SharedGalleryView {...props} services={galleryServices} />;
}
