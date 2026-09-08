/** Thin transport for bounded native Lua menu replay; no source evaluation or simulated success. */
export const MENU_CALLBACKS = [
	"PreStep", "Step", "PostStep", "SceneStep", "OnInit", "OnEnter", "OnSubEnter", "OnFunction", "OnBack",
	"OnSetupLayer", "OnOpenLayer", "OnCloseLayer", "OnOpenEndLayer", "OnCloseEndLayer", "OnUpdateLayer",
	"MoveFocusDec", "MoveFocusInc", "MoveFocusMtx", "OnChangeFocus", "OnDecideFocus", "OnChangeLayerGroup",
	"OnMouseMove", "OnMouseLDown", "OnMouseLOn", "OnMouseLUp",
] as const;
export type MenuCallback = typeof MENU_CALLBACKS[number];
export interface MenuRuntimeEvent {
	callback: MenuCallback;
	args?: readonly (number | boolean | string | null)[];
}
export interface MenuRuntimeRequest {
	locale?: "fr" | "en" | "ja";
	events?: readonly MenuRuntimeEvent[];
	itemCounts?: Readonly<Record<number, number>>;
	/** Pass only observed native state; the Rust owner validates its existing wire schema. */
	observedNative?: Readonly<Record<string, unknown>>;
}
export interface MenuRuntimeObject {
	id: number;
	visible: boolean;
	active: boolean;
	/** Uninterpreted native fields retain their existing snake_case names. */
	[key: string]: unknown;
}
export interface MenuRuntimeLayer {
	id: number;
	visible: boolean;
	enabled: boolean;
	objects: Record<string, MenuRuntimeObject>;
	[key: string]: unknown;
}
export interface MenuRuntimeScene {
	schemaVersion: 1;
	layers: Record<string, MenuRuntimeLayer>;
	groups: Record<string, boolean>;
}
export interface MenuRuntimeResult {
	scene: MenuRuntimeScene;
	/** Lua callback completeness only, never native visual or gameplay equivalence. */
	complete: boolean;
	eventsApplied: number;
	callbacks: MenuCallback[];
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeResult(value: unknown): MenuRuntimeResult {
	if (!record(value) || !record(value.scene) || value.scene.schemaVersion !== 1
		|| !record(value.scene.layers) || !record(value.scene.groups) || typeof value.complete !== "boolean"
		|| !Number.isInteger(value.eventsApplied) || (value.eventsApplied as number) < 0
		|| !Array.isArray(value.callbacks) || !value.callbacks.every(callback => typeof callback === "string" && MENU_CALLBACKS.includes(callback as MenuCallback))) {
		throw new Error("Invalid menu runtime response");
	}
	for (const layer of Object.values(value.scene.layers)) {
		if (!record(layer) || !Number.isInteger(layer.id) || typeof layer.visible !== "boolean"
			|| typeof layer.enabled !== "boolean" || !record(layer.objects)) throw new Error("Invalid menu layer");
		for (const object of Object.values(layer.objects)) {
			if (!record(object) || !Number.isInteger(object.id) || typeof object.visible !== "boolean"
				|| typeof object.active !== "boolean") throw new Error("Invalid menu object");
		}
	}
	if (!Object.values(value.scene.groups).every(flag => typeof flag === "boolean")) throw new Error("Invalid menu groups");
	return value as unknown as MenuRuntimeResult;
}

/** Each response is a fresh replay of the complete supplied input history. */
export async function replayMenuRuntime(screen: string, request: MenuRuntimeRequest = {}, signal?: AbortSignal): Promise<MenuRuntimeResult> {
	if (!/^[A-Za-z0-9_]{1,96}$/.test(screen)) throw new Error("Invalid menu screen");
	if ((request.events?.length ?? 0) > 64) throw new Error("Menu replay event limit reached");
	const response = await fetch(`/api/v1/menu/runtime/${encodeURIComponent(screen)}`, {
		method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify(request), signal, cache: "no-store",
	});
	if (!response.ok) throw new Error("Menu runtime unavailable");
	return decodeResult(await response.json());
}

/** Host-owned session: superseded requests are aborted and never replace the current snapshot. */
export function createMenuRuntime(screen: string, observations: Omit<MenuRuntimeRequest, "events"> = {}) {
	let controller: AbortController | null = null;
	let generation = 0;
	let history: MenuRuntimeEvent[] = [];
	let committed: MenuRuntimeEvent[] = [];
	let snapshot: MenuRuntimeResult | null = null;
	const replay = async (events: readonly MenuRuntimeEvent[] = history) => {
		const next = events.map(event => ({ ...event, args: event.args ? [...event.args] : undefined }));
		if (next.length > 64) throw new Error("Menu replay event limit reached");
		controller?.abort();
		controller = new AbortController();
		const current = ++generation;
		const requestController = controller;
		const deadline = setTimeout(() => requestController.abort(), 2000);
		history = next;
		try {
			const result = await replayMenuRuntime(screen, { ...observations, events: next }, controller.signal);
			if (current !== generation) throw new DOMException("Menu request superseded", "AbortError");
			snapshot = result;
			committed = next;
			return result;
		} catch (error) {
			if (current === generation) history = committed;
			throw error;
		} finally {
			clearTimeout(deadline);
		}
	};
	return {
		get snapshot() { return snapshot; },
		replay,
		dispatch: (event: MenuRuntimeEvent) => replay([...history, event]),
		abort() { generation++; controller?.abort(); history = committed; },
	};
}
