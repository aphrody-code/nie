// Applique en direct les préférences d'apparence (taille de police, zoom) sur le document.
// `fontScale` pilote `html { font-size }` (tout Tailwind est en rem → tout suit).
// `uiZoom` utilise la propriété CSS `zoom` (Chromium/WebView2 — la cible Windows de niers).
import { useEffect } from "react";
import { useSettings } from "@/lib/settings";

const BASE_FONT_SIZE_PX = 16;

export function useApplyAppearance(): void {
  const { fontScale, uiZoom } = useSettings();

  useEffect(() => {
    document.documentElement.style.fontSize = `${BASE_FONT_SIZE_PX * fontScale}px`;
  }, [fontScale]);

  useEffect(() => {
    // `zoom` n'est pas dans le typage CSSStyleDeclaration standard de TS.
    (document.body.style as unknown as { zoom: string }).zoom = String(uiZoom);
  }, [uiZoom]);
}
