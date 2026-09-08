import { describe, expect, mock, test } from "bun:test";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";

import {
  ExplorerBreadcrumbs,
  ExplorerEntries,
  ExplorerPageShell,
  ExplorerSidebar,
  ExplorerStatus,
  ExplorerSurface,
  ExplorerTabsBar,
  ExplorerToolbar,
  ExplorerToolbarButton,
} from "./explorer-surface";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function render(element: React.ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => createRoot(container).render(element));
  return container;
}

function button(container: ParentNode, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return match;
}

describe("Explorer shared presentation", () => {
  test("renders the canonical page hierarchy and list surface", () => {
    const container = render(
      <ExplorerPageShell
        sidebar={<ExplorerSidebar sections={[{ label: "Data", items: [{ id: "vfs", label: "Explorer", icon: "□" }] }]} current="vfs" onSelect={() => {}} />}
      >
        <ExplorerSurface
          tabs={<span>tabs</span>}
          toolbar={<ExplorerToolbar breadcrumbs={<ExplorerBreadcrumbs segments={["data", "common"]} onNavigate={() => {}} />} />}
          status={<ExplorerStatus primary="19 folders, 0 files" />}
          inspectorHeader={<span>Preview</span>}
          inspector={<span>Select a file</span>}
        >
          <ExplorerEntries viewMode="list"><button type="button">action</button></ExplorerEntries>
        </ExplorerSurface>
      </ExplorerPageShell>,
    );

    expect(container.querySelector("[data-explorer-surface]")).not.toBeNull();
    expect(container.querySelector('aside[aria-label="Explorer navigation"]')).not.toBeNull();
    expect(container.querySelector('nav[aria-label="Breadcrumb"]')).not.toBeNull();
    expect(container.querySelector('[role="list"][aria-label="Files and folders"]')).not.toBeNull();
    expect(container.querySelector('[role="separator"][aria-label="Resize inspector"]')).not.toBeNull();
    expect(container.querySelector('aside[aria-label="Inspector"]')).not.toBeNull();
    expect(container.textContent).toContain("19 folders, 0 files");
  });

  test("connects navigation, toolbar and sidebar callbacks", () => {
    const calls: string[] = [];
    const container = render(
      <>
        <ExplorerSidebar sections={[{ items: [{ id: "root", label: "Root" }] }]} current="none" onSelect={(id) => calls.push(id)} />
        <ExplorerToolbar
          leading={<ExplorerToolbarButton label="Back" icon="←" onClick={() => calls.push("back")} />}
          breadcrumbs={<ExplorerBreadcrumbs segments={["data", "common"]} onNavigate={(path) => calls.push(path)} />}
        />
      </>,
    );
    act(() => button(container, "Root").click());
    act(() => button(container, "Back").click());
    act(() => button(container, "common").click());
    expect(calls).toEqual(["root", "back", "data/common"]);
  });

  test("tabs activate, close, middle-close and create", () => {
    const activate = mock(() => {});
    const close = mock(() => {});
    const create = mock(() => {});
    const container = render(
      <ExplorerTabsBar
        tabs={[{ id: "one", prefix: "data/common" }, { id: "two", prefix: "data/menu" }]}
        activeId="one"
        onActivate={activate}
        onClose={close}
        onNew={create}
      />,
    );
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    act(() => tabs[1]?.click());
    act(() => button(container, "Close menu").click());
    act(() => tabs[0]?.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 })));
    act(() => button(container, "New tab").click());
    expect(activate).toHaveBeenCalledWith("two");
    expect(close).toHaveBeenNthCalledWith(1, "two");
    expect(close).toHaveBeenNthCalledWith(2, "one");
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("forwards the entries ref and applies grid geometry", () => {
    const ref = createRef<HTMLDivElement>();
    render(<ExplorerEntries ref={ref} viewMode="grid" gridSize={144}><span>file</span></ExplorerEntries>);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.classList.contains("inacord-explorer-entries--grid")).toBe(true);
    expect(ref.current?.style.getPropertyValue("--explorer-grid-size")).toBe("144px");
  });
});
