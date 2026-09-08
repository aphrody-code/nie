# Shared gallery ownership

`GalleryView` owns the existing Inacord VFS gallery: discovered category folders,
subfolder/locale filtering, text search, progressive thumbnail display, gallery
metadata enrichment, full-resolution lightbox, adjacent-image preloading,
keyboard navigation, PNG export action and reveal-in-explorer callback.

`GalleryServices` injects listing, native image decoding, metadata and export
operations. The desktop compatibility wrapper retains the destination dialog,
native PNG conversion and notifications. Shared presentation does not import
Tauri, desktop aliases, SQL adapters or filesystem code. Existing settings and
thumbnail providers remain required host context.

`gallery.ts` is the pure path/category/thumbnail/enrichment/filter model. The old
desktop `lib/galerie.ts` reexports it. Existing names remain compatible.
`GalleryFilters` is the common controlled category/subfolder chip presentation;
URL writes remain with route adapters.

The full-image cache belongs to each mounted gallery/service identity, includes
the game directory in its key, deduplicates pending requests, and retains at most
three completed images. Host changes cannot reuse another source's pixels.

This extraction does not merge independent SQL catalogues by concatenating
counts, replace native format decoders, or claim that every listed native image
has been rendered. The existing per-category listing limit remains explicit in
the component. Source and interaction validation are separate gates.
