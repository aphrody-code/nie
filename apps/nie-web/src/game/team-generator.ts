/** Lazy runtime boundary for the roster generator, shared by browser and desktop hosts. */
import { configureTeamGeneratorRuntime } from "../desktop/lib/equipe";
import * as wasm from "../wasm/nie_wasm.js";
import { ensureWasm } from "./bridge";

export async function ensureTeamGenerator(): Promise<void> {
  await ensureWasm();
  configureTeamGeneratorRuntime(wasm);
}
