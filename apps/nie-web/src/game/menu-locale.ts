import type { GameLocale } from "@niers/inacord-ui";
import type { NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu";

/**
 * Select the locale pack using the VFS convention shared by measured menu scenes.
 *
 * French is the compiled presentation baseline. Translated European packs use their locale
 * directory while Japanese is the unsuffixed source pack. Geometry, text slots and controls are
 * retained verbatim; this only changes real VFS asset addresses.
 */
export function localizeMenuSceneAssets(scene: NativeMenuScene, locale: GameLocale): NativeMenuScene {
	if (locale === "fr") return scene;
	return {
		...scene,
		layers: scene.layers.map(layer => ({
			...layer,
			assetPath: layer.assetPath.replace(/\/fr\//gu, locale === "ja" ? "/" : `/${locale}/`),
		})),
	};
}
