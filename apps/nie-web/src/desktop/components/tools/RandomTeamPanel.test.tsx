import { afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import init, * as wasm from "../../../wasm/nie_wasm.js";
import { configureTeamGeneratorRuntime } from "../../lib/equipe";
import * as runtime from "../../../game/team-generator";
import { RandomTeamPanel } from "./RandomTeamPanel";

let root: Root;
let container: HTMLDivElement;
let readiness: ReturnType<typeof spyOn<typeof runtime, "ensureTeamGenerator">>;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousEnvironment: boolean | undefined;

beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL("../../../../public/static/game/nie_wasm_bg.wasm", import.meta.url)).arrayBuffer() });
  configureTeamGeneratorRuntime(wasm);
});

beforeEach(() => {
  previousEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  readiness = spyOn(runtime, "ensureTeamGenerator");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  readiness.mockRestore();
  environment.IS_REACT_ACT_ENVIRONMENT = previousEnvironment;
});

test("generator readiness does not execute unavailable synchronous filters", async () => {
  readiness.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<RandomTeamPanel roster={[]} />));
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(container.querySelector("input")).toBeNull();
});

test("generator initialization errors remain visible and retryable", async () => {
  readiness.mockRejectedValueOnce(new Error("runtime unavailable"));
  readiness.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => root.render(<RandomTeamPanel roster={[]} />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("runtime unavailable");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(readiness).toHaveBeenCalledTimes(2);
});

test("editing the seed invokes the actual Rust generator with that exact seed", async () => {
  readiness.mockResolvedValue();
  const generated = spyOn(wasm, "team_generator_generate");
  try {
    await act(async () => root.render(<RandomTeamPanel roster={[]} />));
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Graine de génération"]')!;
    expect(input.value).toBe("5489");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "42");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(generated).toHaveBeenCalledTimes(1);
    expect(generated.mock.calls[0]![4]).toBe(42);
  } finally { generated.mockRestore(); }
});
