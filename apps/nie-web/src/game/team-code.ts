/** Lazy host adapter shared by the builder and random-team tool. */
import * as codec from "@nie/game/game/team-code";
import * as wasm from "../wasm/nie_wasm.js";
import { ensureWasm } from "./bridge";

async function ready(): Promise<void> {
  await ensureWasm();
  codec.configureTeamCodeRuntime(wasm);
}

export async function encodeTeamCode(formationId: string, slots: readonly codec.TeamCodeSlot[]): Promise<string> {
  await ready();
  return codec.encodeTeamCode(formationId, slots);
}

export async function decodeTeamCode(encoded: string): Promise<codec.DecodedTeamCode> {
  await ready();
  return codec.decodeTeamCode(encoded);
}
