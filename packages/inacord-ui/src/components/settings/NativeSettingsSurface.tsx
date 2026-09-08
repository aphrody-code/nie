import type { NativeMenuScene } from "../../shell/native-title-menu";
import { NativeSceneLayers } from "../../shell/native-scene-layers";
import { useAssetSource } from "../../source";
import "./native-settings.css";

/** Fits a native row template to a host setting; it does not claim native screen placement. */
export function NativeSettingsSurface({ scene, focused }: { scene: NativeMenuScene; focused: boolean }) {
	const source = useAssetSource();
	return <svg className="native-settings-row-surface" aria-hidden="true"
		data-native-setting-presentation="row-template" viewBox={`0 0 ${scene.canvas.width} ${scene.canvas.height}`}
		preserveAspectRatio="none">
		<foreignObject width={scene.canvas.width} height={scene.canvas.height}>
			<div style={{ position: "relative", width: scene.canvas.width, height: scene.canvas.height }}>
				<NativeSceneLayers scene={scene} source={source} focusedId={focused ? "setting-row" : null} />
			</div>
		</foreignObject>
	</svg>;
}
