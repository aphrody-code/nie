/**
 * `/avatar` — the GAME's Chara Edit, and nothing that pretends to be it.
 *
 * The native editor (`NativeAvatarEditor`) draws the VFS layers of the `avatar-*` scenes at
 * their measured positions inside a `GameCanvas`, exactly like the title menu does, and the
 * model slot carries the GLB that `nie-model-serve` assembles from the resolved composition.
 *
 * Desktop authoring workspaces are intentionally absent from this public route. Everything else
 * that used to sit here — a studio brand bar, emoji tabs, character
 * "GABARIT" presets, keshin/mixi-max tables, motion and cinematic catalogues, a dialogue writer,
 * a voice recorder and a 2D paint canvas — was literal data typed into this file: no VFS read,
 * no route, no provenance. It is gone.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NativeAvatarEditor } from "@niers/inacord-ui/avatar/NativeAvatarEditor";
import {
  INITIAL_AVATAR_STATE,
  type AvatarCatalog,
  type AvatarComposition,
  type AvatarState,
} from "@niers/inacord-ui/avatar/contract";
import type { NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu";
import type { createStandardGamepadMenuSampler } from "@niers/inacord-ui/shell/menu-interaction";
import { RustModelViewport } from "@niers/inacord-ui/shell/rust-model-viewport";
import { GameHintBar } from "@niers/inacord-ui/components/game/GameHintBar";
import { avatarModelUrl, resolveAvatar } from "../game/avatar-runtime";
import { loadMenuPresentation } from "../game/bridge";
import { createCpuNativeViewer, createNativeViewer } from "../game/native-viewer";
import { NativeText } from "./NativeText";
import { ScreenStatus } from "./screen-parts";
import "@niers/inacord-ui/avatar/avatar-editor.css";
import "./avatar-studio.css";
import { GameText } from "@niers/inacord-ui";
import { useSettings } from "@niers/inacord-ui/lib/settings";
import { localizeMenuSceneAssets } from "../game/menu-locale";
import { AvatarExtensions, profileWithPlayerStats, type AvatarPlayerReference } from "../avatar/AvatarExtensions";

// Every mounted stage writes the Rust-owned AvatarState. Clothes remain visible in the native
// stage rail as explicitly unavailable until categories 19–21 alter the assembled GLB.
const STAGES = ["style", "body", "hair", "stats", "name"] as const;
type Stage = (typeof STAGES)[number];
type AvatarScenes = Record<Stage, NativeMenuScene>;
const SCENES = {
  style: "avatar-top",
  body: "avatar-style",
  hair: "avatar-hair",
  stats: "avatar-stats",
  name: "avatar-name",
} as const;
const DRAFT_KEY = "nie.avatar.draft.v1";

function storedDraft(): AvatarState {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw && raw.length <= 65536) {
      const value = JSON.parse(raw);
      if (
        value.version === 1 &&
        value.state &&
        typeof value.state === "object"
      ) {
        const state = value.state as Partial<AvatarState>;
        return {
          ...INITIAL_AVATAR_STATE,
          ...state,
          profile: {
            ...INITIAL_AVATAR_STATE.profile,
            ...(state.profile ?? {}),
          },
        };
      }
    }
  } catch {
    /* Fallback to default */
  }
  return { ...INITIAL_AVATAR_STATE };
}

const nativeText = (
  text: string,
  options?: { color?: number; height?: number; width?: number },
) => (
  <NativeText
    text={text}
    color={options?.color}
    height={options?.height}
    width={options?.width}
  />
);

export function Avatar({
  onBack,
  onCancel,
  gamepadSampler,
}: {
  onBack?: () => void;
  onCancel?: () => void;
  gamepadSampler?: ReturnType<typeof createStandardGamepadMenuSampler>;
}) {
	const handleBack = onBack ?? onCancel ?? (() => {});
	const { gameLocale } = useSettings();
  const [state, setState] = useState<AvatarState>(storedDraft);
  const [stage, setStage] = useState<Stage>("style");
  const screen = useRef<HTMLDivElement>(null);
  const [playerReference, setPlayerReference] = useState<AvatarPlayerReference | null>(null);

  const [catalog, setCatalog] = useState<AvatarCatalog | null>(null);
  const [scenes, setScenes] = useState<AvatarScenes | null>(null);
  const [composition, setComposition] = useState<AvatarComposition | null>(
    null,
  );
  const [catalogError, setCatalogError] = useState(false);
  const [sceneError, setSceneError] = useState(false);
  const [compositionError, setCompositionError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const back = useCallback(() => {
    const previous = STAGES[STAGES.indexOf(stage) - 1];
    if (previous) setStage(previous);
    else handleBack();
  }, [stage, handleBack]);

  useEffect(() => {
    const abort = new AbortController();
    setCatalogError(false);
    const fetchCatalog = async () => {
      let response = await fetch("/assets/avatar/catalog.json", {
        signal: abort.signal,
        headers: { accept: "application/json" },
      }).catch(() => null);
      if (!response || !response.ok) {
        response = await fetch("/avatar/catalog.json", {
          signal: abort.signal,
          headers: { accept: "application/json" },
        });
      }
      if (!response.ok) throw new Error("Avatar catalogue unavailable");
      return response.json() as Promise<AvatarCatalog>;
    };

    fetchCatalog()
      .then((value) => {
        if (!abort.signal.aborted) setCatalog(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) setCatalogError(true);
      });
    return () => abort.abort();
  }, [attempt]);

  useEffect(() => {
    let active = true;
    setSceneError(false);
    Promise.all(
      STAGES.map(
		async (key) => [key, localizeMenuSceneAssets(await loadMenuPresentation(SCENES[key]), gameLocale)] as const,
      ),
    )
      .then((values) => {
        if (active) setScenes(Object.fromEntries(values) as AvatarScenes);
      })
      .catch(() => {
        if (active) setSceneError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, gameLocale]);

  useEffect(() => {
    if (!catalog) return;
    let active = true;
    setCompositionError(false);
    resolveAvatar(catalog, state)
      .then((value) => {
        if (active) setComposition(value);
      })
      .catch(async () => {
        // Self-heal: if saved draft or state is invalid, reset to initial state cleanly
        try {
          const fallback = await resolveAvatar(catalog, INITIAL_AVATAR_STATE);
          if (active) {
            setState({ ...INITIAL_AVATAR_STATE });
            setComposition(fallback);
            try {
              localStorage.removeItem(DRAFT_KEY);
            } catch {
              /* Ignore */
            }
            return;
          }
        } catch {
          /* fallback also failed */
        }
        if (active) setCompositionError(true);
      });
    return () => {
      active = false;
    };
  }, [catalog, state, attempt]);

  useEffect(() => {
    if (!composition) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ version: 1, state }),
      );
    } catch {
      /* Ignore */
    }
  }, [state, composition]);

  // Escape is the game's cancel: one stage back, then the tab, then the caller's screen.
  // `GameHintBar` owns it so the key and the on-screen hint can never drift apart.
  const hints = useMemo(
    () => [
      { key: "Escape", keyLabel: "Esc", label: "Retour", onActivate: back },
    ],
    [back],
  );

  const modelViewport = useMemo(
    () => (
      <RustModelViewport
        url={playerReference?.modelUrl ?? (composition ? avatarModelUrl(composition) : null)}
        createViewer={createNativeViewer}
		createFallbackViewer={createCpuNativeViewer}
        label={playerReference ? `Référence ${playerReference.name}` : "Aperçu de l’avatar"}
      />
    ),
    [composition, playerReference],
  );

  const error = catalogError || sceneError || compositionError;
  if (!catalog || !scenes || error) {
    return (
      <section aria-label="Éditeur d’avatar" className="avatar-resource-state">
        <header>
          <button type="button" data-avatar-control="back" onClick={back} aria-label="Retour au menu">
            <GameText>Retour</GameText>
          </button>
        </header>
        <ScreenStatus
          state={error ? "unavailable" : "loading"}
          onRetry={error ? () => setAttempt((v) => v + 1) : undefined}
        />
        {compositionError && (
          <button
            type="button"
            onClick={() => {
              setState({ ...INITIAL_AVATAR_STATE });
            }}
          >
            Réinitialiser les choix
          </button>
        )}
      </section>
    );
  }

  return (
    <div ref={screen} className="avatar-screen" data-avatar-tab="chara-edit">
      <div className="avatar-screen__stage">
        <NativeAvatarEditor
          catalog={catalog}
          state={state}
          onStateChange={(next) => {
            setPlayerReference(null);
            setState(next);
          }}
          gamepadSampler={gamepadSampler}
          onBack={back}
          stage={stage}
          onStageChange={setStage}
          scene={scenes[stage]}
          renderText={nativeText}
          model={modelViewport}
        />
        {playerReference ? <aside className="avatar-reference" aria-label="Référence joueur">
          <strong>{playerReference.name}</strong>
          <span>{playerReference.internalCode}{playerReference.modelId ? ` · modèle ${playerReference.modelId}` : ""}</span>
          <span>Référence uniquement — non convertie en pièces Chara Edit.</span>
          {playerReference.stats ? <button type="button" onClick={() => setState((current) => ({
            ...current,
            profile: profileWithPlayerStats(current.profile, playerReference.stats!),
          }))}>Copier les statistiques vers l’OC</button> : null}
          <button type="button" onClick={() => setPlayerReference(null)}>Revenir à l’OC éditable</button>
        </aside> : null}
      </div>
      <footer className="avatar-screen__chrome">
        <AvatarExtensions
          catalog={catalog}
          state={state}
          modelUrl={playerReference?.modelUrl ?? (composition ? avatarModelUrl(composition) : null)}
          captureRoot={screen}
          onState={setState}
          onPlayerReference={setPlayerReference}
        />
        <GameHintBar className="avatar-screen__hints" hints={hints} />
      </footer>
    </div>
  );
}
