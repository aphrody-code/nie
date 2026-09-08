/** Minimal resource identity shared by the existing SQL and manifest adapters. */
export interface GalleryRecord {
 imgPath: string;
 category: string;
 title: string;
}

export function galleryResourceKey(path: string): string {
 const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '')
  .replace(/^(?:data\/)?(?:dx11\/)?menu\/220_img\//, '')
  .replace(/\.(?:g4tx|png|webp)$/i, '');
 return normalized.includes('/') ? normalized : `gallery_img2/${normalized}`;
}

/** SQL rows enrich the matching manifest resource; neither source is counted twice. */
export function mergeGalleryRecords<T extends GalleryRecord>(rows: readonly T[], manifest: readonly T[]): T[] {
 const byResource = new Map<string, T>();
 for (const item of rows) {
  const key = galleryResourceKey(item.imgPath);
  if (item.imgPath && !byResource.has(key)) byResource.set(key, item);
 }
 for (const item of manifest) {
  const key = galleryResourceKey(item.imgPath);
  if (item.imgPath && !byResource.has(key)) byResource.set(key, item);
 }
 return [...byResource.values()];
}

/** Folder and semantic categories are independent facets of the same resource. */
export function filterGalleryRecords<T extends GalleryRecord>(items: readonly T[], category?: string, query?: string): T[] {
 const needle = query?.trim().toLocaleLowerCase() ?? '';
 return items.filter(item => {
  const folder = galleryResourceKey(item.imgPath).split('/')[0];
  const categoryMatches = !category || category === 'all' || category === 'menu'
   || category === item.category || category === folder;
  return categoryMatches && (!needle || item.title.toLocaleLowerCase().includes(needle)
   || item.imgPath.toLocaleLowerCase().includes(needle));
 });
}

export function countGalleryRecords(items: readonly GalleryRecord[]): Record<string, number> {
 const counts: Record<string, number> = { all: items.length };
 for (const item of items) {
  const facets = new Set([item.category, galleryResourceKey(item.imgPath).split('/')[0]]);
  for (const facet of facets) if (facet && facet !== 'all') counts[facet] = (counts[facet] ?? 0) + 1;
 }
 return counts;
}
