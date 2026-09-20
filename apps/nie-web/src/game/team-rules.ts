/** Runtime readiness for synchronous team-builder calculations owned by Rust. */
import { configureTeamRulesRuntime } from "@niers/game/game/team-rules";
import * as wasm from "../wasm/nie_wasm.js";
import { ensureWasm } from "./bridge";

export async function ensureTeamRules(): Promise<void> {
  await ensureWasm();
  configureTeamRulesRuntime(wasm);
}
