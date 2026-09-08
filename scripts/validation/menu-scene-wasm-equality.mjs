/**
 * Compare native runtime scene exports with the actual generated WebAssembly ABI.
 *
 * Build first: bun apps/nie-web/scripts/build-wasm.ts
 * Usage: bun scripts/validation/menu-scene-wasm-equality.mjs <runtime-layout.json> [...]
 * Inputs must be native --export-layout-runtime outputs containing runtimeScenes.
 * Corpus fixtures stay outside source control. This measures object state, not rendering parity.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initSync, menu_runtime_scene_json } from '../../apps/nie-web/src/wasm/nie_wasm.js';

const paths = process.argv.slice(2);
assert(paths.length > 0, 'Pass at least one native runtime-layout JSON export');
const wasmBytes = readFileSync(new URL('../../apps/nie-web/public/static/game/nie_wasm_bg.wasm', import.meta.url));
initSync({ module: wasmBytes });
let scenes = 0;
let layers = 0;
let objects = 0;
for (const path of paths) {
    const document = JSON.parse(readFileSync(path, 'utf8'));
    assert(document.runtimeScenes && typeof document.runtimeScenes === 'object', 'Missing native runtimeScenes');
    const nativeScenes = Object.values(document.runtimeScenes);
    assert(nativeScenes.length > 0, 'Native export contains no scenes');
    for (const scene of nativeScenes) {
        // Only observed renderer fields are supplied. Host input/telemetry defaults are
        // excluded by the shared scene compiler and must not affect the result.
        const state = {
            layers: scene.layers,
            groups: scene.groups,
            object_attr: {},
            text_by_id: {},
            condition_flags: {},
            list_counts: {},
            resource_ids: [],
            engine_int_2728: null,
            unknown_cmd_log: [],
            unknown_general_cmd_log: [],
            known_cmd_log: [],
            current_layer: 0,
        };
        const actual = JSON.parse(menu_runtime_scene_json(JSON.stringify(state)));
        assert.deepStrictEqual(actual, scene, 'Native and WebAssembly object state differs');
        scenes++;
        layers += Object.keys(actual.layers).length;
        objects += Object.values(actual.layers).reduce((sum, layer) => sum + Object.keys(layer.objects).length, 0);
    }
}
for (const input of ['{}', 'null', 'invalid']) {
    assert.throws(() => menu_runtime_scene_json(input), 'Invalid state must fail instead of producing an empty scene');
}
assert(objects > 0, 'At least one observed runtime object is required');
console.log(JSON.stringify({
    scenes,
    layers,
    objects,
    invalidStatesRejected: 3,
    nativeWasmEquality: true,
    wasmSha256: createHash('sha256').update(wasmBytes).digest('hex'),
}));
