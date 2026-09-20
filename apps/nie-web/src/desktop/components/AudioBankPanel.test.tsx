import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "@/lib/api";
import { AudioBankPanel } from "./AudioBankPanel";

let root: Root;
let container: HTMLDivElement;
let cues: ReturnType<typeof spyOn<typeof api, "audioCues">>;
let decode: ReturnType<typeof spyOn<typeof api, "audioCueWavB64">>;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousEnvironment: boolean | undefined;

beforeEach(() => {
  previousEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cues = spyOn(api, "audioCues").mockResolvedValue({
    playable: true,
    source: "self",
    cues: [{ name: "one", awb_id: 1, length_ms: 1000, codec: "HCA", sample_rate: 48000, size: 20 }],
  } as Awaited<ReturnType<typeof api.audioCues>>);
  decode = spyOn(api, "audioCueWavB64");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  cues.mockRestore();
  decode.mockRestore();
  environment.IS_REACT_ACT_ENVIRONMENT = previousEnvironment;
});

test("a decoded cue from the previous bank cannot replace the current bank", async () => {
  let finishOld!: (value: string) => void;
  decode.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  decode.mockResolvedValueOnce("current");
  await act(async () => root.render(<AudioBankPanel path="old.acb" />));
  await act(async () => container.querySelector<HTMLButtonElement>('button[title="Décoder et jouer cette piste"]')!.click());
  await act(async () => root.render(<AudioBankPanel path="current.acb" />));
  await act(async () => container.querySelector<HTMLButtonElement>('button[title="Décoder et jouer cette piste"]')!.click());
  expect(container.querySelector("audio")?.getAttribute("src")).toBe("data:audio/wav;base64,current");
  await act(async () => { finishOld("stale"); await Promise.resolve(); });
  expect(container.querySelector("audio")?.getAttribute("src")).toBe("data:audio/wav;base64,current");
  expect(decode).toHaveBeenCalledTimes(2);
});
