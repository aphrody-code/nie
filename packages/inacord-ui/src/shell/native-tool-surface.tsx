import { useAssetSource } from "../source";
import { NativeSprite, type NativeSpriteState } from "./native-sprite";
import "./native-tool-surface.css";

/** Verified native row material, reused as host chrome without claiming native placement. */
export const NATIVE_TOOL_ROW = {
	assetPath: "data/dx11/menu/108_option/option01/option01_02/option01_02.g4tx",
	idle: "option_list_base02_off",
	active: "option_list_base02_on",
	width: 1216,
	height: 76,
	provenance: "nie-formats/src/menu_scenes/setting-row.json",
} as const;

/** The surrounding host retains its labels, accessibility and complete interaction policy. */
export function NativeToolSurface({ active, onStateChange }: {
	active: boolean;
	onStateChange?: (state: NativeSpriteState) => void;
}) {
	const source = useAssetSource();
	return <svg className="native-tool-surface" aria-hidden="true"
		data-native-presentation="host-row-material"
		viewBox={`0 0 ${NATIVE_TOOL_ROW.width} ${NATIVE_TOOL_ROW.height}`} preserveAspectRatio="none">
		<foreignObject width={NATIVE_TOOL_ROW.width} height={NATIVE_TOOL_ROW.height}>
			<div style={{ position: "relative", width: NATIVE_TOOL_ROW.width, height: NATIVE_TOOL_ROW.height }}>
				<NativeSprite source={source} assetPath={NATIVE_TOOL_ROW.assetPath}
					region={active ? NATIVE_TOOL_ROW.active : NATIVE_TOOL_ROW.idle}
					rect={{ x: 0, y: 0, w: NATIVE_TOOL_ROW.width, h: NATIVE_TOOL_ROW.height }}
					active={active} onStateChange={onStateChange} />
			</div>
		</foreignObject>
	</svg>;
}
