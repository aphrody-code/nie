/**
 * Compare a native G4RA binding export with the actual WebAssembly parser.
 * Usage: bun scripts/validation/menu-animation-wasm-equality.mjs <raw.g4ra> <native.json> [--wasm-file <module.wasm>]
 * Native reports must contain { schemaVersion: 1, bindings: ... } from the shared parser.
 * Private payloads and downloaded public Wasm remain outside source control.
 * This verifies decoded bindings, not animation playback or visual fidelity.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initSync, menu_animation_bindings_json } from '../../apps/nie-web/src/wasm/nie_wasm.js';

const args = process.argv.slice(2);
assert(args.length === 2 || (args.length === 4 && args[2] === '--wasm-file'),
    'Usage: <raw.g4ra> <native.json> [--wasm-file <module.wasm>]');
const payload = readFileSync(args[0]);
const expected = JSON.parse(readFileSync(args[1], 'utf8'));
assert.equal(expected.schemaVersion, 1, 'Unsupported native report schema');
assert(expected.bindings && typeof expected.bindings === 'object', 'Native report must contain decoded bindings');
const wasmBytes = readFileSync(args[3] ?? new URL('../../apps/nie-web/public/static/game/nie_wasm_bg.wasm', import.meta.url));
initSync({ module: wasmBytes });
const actual = JSON.parse(menu_animation_bindings_json(payload));
assert.deepStrictEqual(actual, expected, 'Native and WebAssembly animation bindings differ');
const { state_hashes, skeletal_bindings, material_bindings } = actual.bindings;
assert(Array.isArray(state_hashes) && state_hashes.length > 0, 'Native export must contain observed states');
assert(Array.isArray(skeletal_bindings) && Array.isArray(material_bindings), 'Missing binding categories');
assert(skeletal_bindings.length + material_bindings.length > 0, 'At least one observed binding is required');

const badMagic = new Uint8Array(payload);
badMagic.fill(0, 0, Math.min(4, badMagic.length));
for (const input of [new Uint8Array(), payload.subarray(0, 3), badMagic]) {
    assert.throws(() => menu_animation_bindings_json(input), 'Malformed G4RA must fail instead of returning empty bindings');
}
console.log(JSON.stringify({
    nativeWasmEquality: true,
    payloadBytes: payload.length,
    states: state_hashes.length,
    skeletalBindings: skeletal_bindings.length,
    materialBindings: material_bindings.length,
    malformedInputsRejected: 3,
    wasmSha256: createHash('sha256').update(wasmBytes).digest('hex'),
}));
