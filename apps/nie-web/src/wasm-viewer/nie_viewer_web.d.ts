/* tslint:disable */
/* eslint-disable */

/**
 * Le viewer, présenté au navigateur.
 *
 * Même surface que `WebGpuViewer` de `nie-wasm` — mêmes noms, mêmes signatures — pour que
 * l'hôte puisse permuter les deux sans adaptateur.
 */
export class ModelViewer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Le backend RÉELLEMENT obtenu, en JSON — WebGPU ou WebGL selon ce que le moteur offrait.
     *
     * Publié parce que la différence est observable à l'écran et qu'un diagnostic vaut mieux
     * qu'une supposition : les deux backends ne rendent pas exactement les mêmes pixels. Le
     * format suit celui de `WebGpuViewer::backend_info` de `nie-wasm`, pour qu'un hôte lise les
     * deux avec le même code.
     */
    backend_info(): string;
    /**
     * Initialise une surface sur le canvas. Échoue si ni WebGPU ni WebGL 2 ne répondent.
     */
    static create(canvas: HTMLCanvasElement): Promise<ModelViewer>;
    /**
     * La même chose, en laissant voir ce qui est derrière le canvas.
     */
    static create_transparent(canvas: HTMLCanvasElement): Promise<ModelViewer>;
    /**
     * Charge ou remplace le modèle GLB affiché.
     */
    load_glb(bytes: Uint8Array): void;
    /**
     * Caméra absolue : angles en radians, distance en rayons du modèle.
     */
    orbit(yaw: number, pitch: number, distance: number): void;
    /**
     * Présente une image. `false` quand il n'y a rien à présenter.
     */
    render(): boolean;
    /**
     * Dimensions en pixels PHYSIQUES ; le calcul du ratio appartient à l'hôte.
     */
    resize(width: number, height: number): void;
}

/**
 * Installe le crochet de panique pour que la console nomme la ligne fautive.
 */
export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_modelviewer_free: (a: number, b: number) => void;
    readonly modelviewer_backend_info: (a: number, b: number) => void;
    readonly modelviewer_create: (a: number) => number;
    readonly modelviewer_create_transparent: (a: number) => number;
    readonly modelviewer_load_glb: (a: number, b: number, c: number, d: number) => void;
    readonly modelviewer_orbit: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly modelviewer_render: (a: number, b: number) => void;
    readonly modelviewer_resize: (a: number, b: number, c: number, d: number) => void;
    readonly start: () => void;
    readonly __wasm_bindgen_func_elem_8717: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_8719: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_2774: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_2774_2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export5: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
