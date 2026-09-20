/** Team-code contract. Encoding and recovery rules belong to nie-core::azalee::team_code. */
export interface TeamCodeSlot {
  slot: string;
  charaId: string;
}

export interface DecodedTeamCode {
  formationId: string;
  slots: TeamCodeSlot[];
}

/** Native or WASM host bindings; no JavaScript codec fallback. */
export interface TeamCodeRuntime {
  team_code_encode(formationId: string, slotsJson: string): string;
  team_code_decode(encoded: string): string;
  team_code_utf8_to_base64(text: string): string;
  team_code_base64_to_utf8(encoded: string): string;
}

let runtime: TeamCodeRuntime | undefined;

/** Hosts install the shared Rust bindings after successful runtime initialization. */
export function configureTeamCodeRuntime(bindings: TeamCodeRuntime): void {
  runtime = bindings;
}

function bindings(): TeamCodeRuntime {
  if (!runtime) throw new Error("Team code runtime is not initialized");
  return runtime;
}

export function utf8ToBase64(text: string): string {
  return bindings().team_code_utf8_to_base64(text);
}

export function base64ToUtf8(encoded: string): string {
  return bindings().team_code_base64_to_utf8(encoded);
}

export function encodeTeamCode(formationId: string, slots: readonly TeamCodeSlot[]): string {
  return bindings().team_code_encode(formationId, JSON.stringify(slots));
}

export function decodeTeamCode(encoded: string): DecodedTeamCode {
  return JSON.parse(bindings().team_code_decode(encoded)) as DecodedTeamCode;
}
