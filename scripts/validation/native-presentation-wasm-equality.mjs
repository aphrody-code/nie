/** Compare compiled native scene/font outputs against the actual browser WebAssembly module.
 * Usage: bun scripts/validation/native-presentation-wasm-equality.mjs <native.json> <font-directory>
 * Native: cargo run -p nie-formats --features serde,textures --example menu_presentation_export -- <font-directory>
 * Private VFS assets are never stored in this script or committed with its reports.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initSync, menu_presentation_json, WasmBitmapFont } from '../../apps/nie-web/src/wasm/nie_wasm.js';
const [report, directory] = process.argv.slice(2);
assert(report && directory, 'Expected native JSON and private font directory');
const native = JSON.parse(readFileSync(report, 'utf8'));
assert.equal(native.schemaVersion, 1);
const wasm = readFileSync(new URL('../../apps/nie-web/public/static/game/nie_wasm_bg.wasm', import.meta.url));
initSync({ module: wasm });
assert(native.scenes.length >= 3 && native.texts.length >= 5, 'Non-zero scene and multilingual text corpus required');
for (const scene of native.scenes) {
    assert.deepEqual(JSON.parse(menu_presentation_json(scene.id)), scene);
}
const font = new WasmBitmapFont(readFileSync(join(directory, 'font.cfg.bin')), readFileSync(join(directory, 'font.g4tx')));
try {
    for (const expected of native.texts) {
        const rgba = font.render(expected.text, 0x224466ff);
        assert.equal(font.width, expected.width);
        assert.equal(font.height, expected.height);
        assert.equal(Bun.hash.crc32(rgba) >>> 0, expected.rgbaCrc32);
        assert(rgba.some((value, index) => index % 4 === 3 && value > 0));
    }
    assert.throws(() => font.render('\u{10ffff}', 0xffffffff));
    assert.throws(() => font.render('A'.repeat(513), 0xffffffff));
} finally { font.free(); }
assert.throws(() => menu_presentation_json('unknown-screen'));
assert.throws(() => new WasmBitmapFont(new Uint8Array(), new Uint8Array()));
console.log(JSON.stringify({ scenes: native.scenes.length, multilingualTextRuns: native.texts.length, invalidInputsRejected: 4,
    nativeWasmEquality: true, wasmSha256: createHash('sha256').update(wasm).digest('hex') }));
