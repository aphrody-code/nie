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
     * Oublie les assets déposés ; le modèle déjà affiché n'est pas touché.
     */
    clear_assets(): void;
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
     * Compose et affiche un document de scène v2 depuis les assets déposés.
     *
     * Plusieurs objets, leur hiérarchie et leur TRS complet : ce qu'un éditeur montre, là où
     * `load_glb` n'affiche qu'un modèle. `pick_json` nomme alors l'objet touché.
     */
    load_scene(document_json: string): void;
    /**
     * Caméra absolue : angles en radians, distance en rayons du modèle.
     */
    orbit(yaw: number, pitch: number, distance: number): void;
    /**
     * La surface sous le pixel `(x, y)` du backing store, en JSON, ou `undefined` sur le fond.
     *
     * `{"primitive":n,"triangle":n,"distance":f,"point":[x,y,z]}`. La caméra inversée est celle
     * de l'image courante, par la même base orbitale que la matrice de vue.
     */
    pick_json(x: number, y: number): string | undefined;
    /**
     * Présente une image. `false` quand il n'y a rien à présenter.
     */
    render(): boolean;
    /**
     * Dimensions en pixels PHYSIQUES ; le calcul du ratio appartient à l'hôte.
     */
    resize(width: number, height: number): void;
    /**
     * Décode un asset GLB et le garde sous le chemin que le document de scène lui donne.
     */
    stage_asset(asset: string, bytes: Uint8Array): void;
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
    readonly modelviewer_clear_assets: (a: number) => void;
    readonly modelviewer_create: (a: number) => number;
    readonly modelviewer_create_transparent: (a: number) => number;
    readonly modelviewer_load_glb: (a: number, b: number, c: number, d: number) => void;
    readonly modelviewer_load_scene: (a: number, b: number, c: number, d: number) => void;
    readonly modelviewer_orbit: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly modelviewer_pick_json: (a: number, b: number, c: number, d: number) => void;
    readonly modelviewer_render: (a: number, b: number) => void;
    readonly modelviewer_resize: (a: number, b: number, c: number, d: number) => void;
    readonly modelviewer_stage_asset: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly start: () => void;
    readonly __wasm_bindgen_func_elem_7038: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_7059: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_1484: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_1484_2: (a: number, b: number, c: number) => void;
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
