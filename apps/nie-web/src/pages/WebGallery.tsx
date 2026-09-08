import { useMemo, useState } from "react";
import { useAssetSource } from "@niers/inacord-ui";
import { writeBrowserHistory } from "@niers/inacord-ui/lib/browser-navigation";
import { GalleryView } from "@niers/inacord-ui/gallery/GalleryView";
import type { GalleryServices } from "@niers/inacord-ui/gallery/contracts";
import { readableSize } from "./SecondaryScreen";

/** HTTP adapter for the same gallery used by the desktop explorer. */
export function WebGallery() {
 const source = useAssetSource();
 const [exportError, setExportError] = useState(false);
 const services = useMemo<GalleryServices>(() => {
  async function imageBlob(path: string) {
   if (!source.urlTexture) throw new Error("Texture decoding is unavailable");
   const response = await fetch(source.urlTexture(path));
   if (!response.ok) throw new Error(`Texture unavailable (${response.status})`);
   return response.blob();
  }
  return {
   async ls(prefix) {
    const result = await source.parcourir(prefix, { ext: "g4tx", parPage: 1 });
    return { dirs: result.dossiers.map(path => ({
     name: path.replace(/\/$/, "").split("/").pop()!,
     count: result.folderCounts?.[path] ?? 0,
    })) };
   },
   async findPaged(query, ext, limit, offset) {
    if (!source.catalogue) throw new Error("Paged resource listing is unavailable");
    const files: { path: string; size: number }[] = [];
    let page = 1;
    let skipped = 0;
    while (files.length < limit) {
     const result = await source.catalogue("textures", { q: query, ext, page, parPage: 200 });
     for (const entry of result.elements) {
      if (skipped++ < offset) continue;
      if (!entry.chemin.startsWith(query)) continue;
      if (files.length < limit) files.push({ path: entry.chemin, size: entry.taille });
     }
     if (page >= result.pages) break;
     if (!result.elements.length) throw new Error("Resource page is incomplete");
     page++;
    }
    return { files };
   },
   async gameDataGallery() {
    const records: Awaited<ReturnType<GalleryServices["gameDataGallery"]>> = [];
    let offset = 0;
    while (true) {
     const response = await fetch(`/api/v1/wiki/gallery?limit=200&offset=${offset}`);
     if (!response.ok) throw new Error("Gallery metadata is unavailable");
     const result = await response.json() as { total: number; records: {
      imgPath: string | null; thumbPath: string | null; needTokenNum: number | null;
     }[] };
     for (const row of result.records) records.push({
      img_path: row.imgPath ?? "", thumb_path: row.thumbPath ?? "",
      unlock_kind: row.needTokenNum === null ? "" : `Jetons requis : ${row.needTokenNum}`,
      story_episode: null,
     });
     offset += result.records.length;
     if (offset >= result.total) break;
     if (!result.records.length) throw new Error("Gallery metadata page is incomplete");
    }
    return records;
   },
   async texturePngB64(path) {
    const blob = await imageBlob(path);
    return new Promise<string>((resolve, reject) => {
     const reader = new FileReader();
     reader.onload = () => resolve(String(reader.result).split(",", 2)[1]!);
     reader.onerror = () => reject(reader.error);
     reader.readAsDataURL(blob);
    });
   },
   async exportPng(path) {
    setExportError(false);
    try {
    const blob = await imageBlob(path);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image"}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError(true); }
   },
   formatBytes: readableSize,
  };
 }, [source]);
 return <div className="h-[75vh] min-h-96">{exportError && <p role="alert">L’image n’a pas pu être exportée.</p>}<GalleryView services={services}
  onOpenFile={path => {
   const url = new URL(window.location.href);
   url.searchParams.set("vue", "textures");
   url.searchParams.delete("display");
   url.searchParams.set("q", path);
   writeBrowserHistory(url, window.history.state, "push");
  }} /></div>;
}
