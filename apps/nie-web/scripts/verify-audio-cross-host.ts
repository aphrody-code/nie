import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import init, {
	audio_bank_cue_to_wav,
	audio_bank_json,
	audio_cue_to_wav,
} from "../src/wasm/nie_wasm.js";

const DEFAULT_BANK = "data/common/sound_asset/en/ev01_0.acb";
const DEFAULT_BASE = "http://127.0.0.1:19323";
const DEFAULT_REPORT = resolve(import.meta.dir, "../../../var/azalee/audio-cross-host.json");
const SAMPLE_COUNT = 3;
const INVALID_AWB_ID = 65_535;

interface CueMetadata {
	name: string;
	awbId: number | null;
}

interface BankMetadata {
	cues: CueMetadata[];
}

function option(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function vfsUrl(base: string, prefix: string, path: string): string {
	return `${base}${prefix}${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function bytes(url: string): Promise<Uint8Array> {
	const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
	return new Uint8Array(await response.arrayBuffer());
}

function sha256(value: Uint8Array): string {
	return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

const bank = option("--bank") ?? process.env.NIE_AUDIO_BANK_PATH ?? DEFAULT_BANK;
if (!bank.endsWith(".acb")) throw new Error("--bank must be an ACB VFS path");
const waveformBank = `${bank.slice(0, -4)}.awb`;
const base = (option("--base") ?? process.env.NIE_AUDIO_BASE_URL ?? DEFAULT_BASE).replace(/\/$/u, "");
const parsedBase = new URL(base);
if (parsedBase.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsedBase.hostname)) {
	throw new Error("--base must be a loopback HTTP origin");
}
const reportPath = resolve(option("--report") ?? process.env.NIE_AUDIO_REPORT_PATH ?? DEFAULT_REPORT);

const wasmPath = resolve(import.meta.dir, "../public/static/game/nie_wasm_bg.wasm");
const wasmBytes = new Uint8Array(await Bun.file(wasmPath).arrayBuffer());
await init({ module_or_path: await WebAssembly.compile(wasmBytes) });

const acb = await bytes(vfsUrl(base, "/f/", bank));
const awb = await bytes(vfsUrl(base, "/f/", waveformBank));
const metadata = JSON.parse(audio_bank_json(bank, acb)) as BankMetadata;
const cues = metadata.cues.filter((cue): cue is CueMetadata & { awbId: number } => cue.awbId !== null).slice(0, SAMPLE_COUNT);
if (cues.length !== SAMPLE_COUNT) throw new Error(`Expected ${SAMPLE_COUNT} playable cues, found ${cues.length}`);

const rows = [];
for (const cue of cues) {
	const direct = audio_cue_to_wav(awb, cue.awbId);
	const named = audio_bank_cue_to_wav(acb, awb, cue.name);
	const served = await bytes(`${vfsUrl(base, "/assets/audio/", bank)}?id=${cue.awbId}`);
	const hashes = { direct: sha256(direct), named: sha256(named), http: sha256(served) };
	const equal = hashes.direct === hashes.named && hashes.named === hashes.http;
	if (!equal) throw new Error(`Audio SHA-256 mismatch for AWB id ${cue.awbId}`);
	rows.push({ awbId: cue.awbId, name: cue.name, bytes: direct.byteLength, sha256: hashes.direct, equal });
}

let invalidError = "";
try {
	audio_cue_to_wav(awb, INVALID_AWB_ID);
} catch (error) {
	invalidError = String(error);
}
if (invalidError !== "Waveform ID is absent from the AWB") {
	throw new Error(`Unexpected invalid-id result: ${invalidError || "success"}`);
}
const afterInvalid = audio_cue_to_wav(awb, cues[0]!.awbId);
if (sha256(afterInvalid) !== rows[0]!.sha256) throw new Error("WASM runtime changed after the controlled invalid-id error");

const report = {
	schemaVersion: 1,
	measuredAt: new Date().toISOString(),
	base,
	bank,
	waveformBank,
	wasmBytes: wasmBytes.byteLength,
	sampleCount: rows.length,
	invalidAwbId: INVALID_AWB_ID,
	invalidError,
	runtimeRecovered: true,
	rows,
};
await mkdir(dirname(reportPath), { recursive: true });
await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`audio cross-host: ${rows.length}/${SAMPLE_COUNT} SHA-256 matches; report ${reportPath}`);
