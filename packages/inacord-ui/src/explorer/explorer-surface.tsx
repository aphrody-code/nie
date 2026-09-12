import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEventHandler, MouseEventHandler, ReactNode } from "react";

import type { ExplorerViewMode } from "./explorer-tabs";
import "./explorer-surface.css";
import { GameText } from "../lib/game-text-context";

function joinClassName(...names: Array<string | undefined | false>): string {
  return names.filter(Boolean).join(" ");
}

export interface ExplorerSurfaceProps {
  tabs?: ReactNode;
  toolbar: ReactNode;
  filters?: ReactNode;
  error?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
  status?: ReactNode;
  selectionBar?: ReactNode;
  inspectorHeader?: ReactNode;
  inspector?: ReactNode;
  inspectorWidth?: CSSProperties["width"];
  inspectorDefaultSize?: number;
  inspectorMinSize?: number;
  inspectorMaxSize?: number;
  inspectorStorageKey?: string;
  className?: string;
}

/**
 * Host-neutral Explorer frame shared by the browser and desktop applications.
 * Data loading and mutations deliberately remain in the host adapter; this component owns the
 * visible toolbar/content/status/inspector geometry only.
 */
export function ExplorerSurface({
  tabs,
  toolbar,
  filters,
  error,
  notice,
  children,
  status,
  selectionBar,
  inspectorHeader,
  inspector,
  inspectorWidth = "clamp(240px, 24vw, 880px)",
  inspectorDefaultSize = 320,
  inspectorMinSize = 240,
  inspectorMaxSize = 880,
  inspectorStorageKey = "explorer-inspector",
  className,
}: ExplorerSurfaceProps) {
  const hasInspector = inspectorHeader != null || inspector != null;
  const hostRef = useRef<HTMLElement | null>(null);
  const dragging = useRef(false);
  const [resizedWidth, setResizedWidth] = useState<number | null>(() => {
    if (!hasInspector || typeof localStorage === "undefined") return null;
    const stored = Number(localStorage.getItem(`nie-explorer:split:${inspectorStorageKey}`));
    return Number.isFinite(stored) && stored > 0 ? stored : inspectorDefaultSize;
  });
  const endResize = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.removeProperty("cursor");
    document.body.style.userSelect = "";
    if (resizedWidth != null && typeof localStorage !== "undefined") {
      localStorage.setItem(`nie-explorer:split:${inspectorStorageKey}`, String(resizedWidth));
    }
  }, [inspectorStorageKey, resizedWidth]);
  useEffect(() => {
    window.addEventListener("pointerup", endResize);
    return () => window.removeEventListener("pointerup", endResize);
  }, [endResize]);
  const resolvedInspectorWidth = resizedWidth ?? inspectorWidth;
  return (
    <section
      ref={hostRef}
      className={joinClassName(
        "inacord-explorer",
        tabs != null && "inacord-explorer--with-tabs",
        !hasInspector && "inacord-explorer--single",
        className,
      )}
      style={hasInspector ? ({ "--explorer-inspector-width": typeof resolvedInspectorWidth === "number" ? `${resolvedInspectorWidth}px` : resolvedInspectorWidth } as CSSProperties) : undefined}
      data-explorer-surface=""
    >
      {tabs != null && <div className="inacord-explorer__tabs">{tabs}</div>}
      <main className="inacord-explorer__main">
        <header className="inacord-explorer__toolbar">{toolbar}</header>
        {filters != null && <div className="inacord-explorer__filters">{filters}</div>}
        {error != null && (
          <div className="inacord-explorer__error" role="alert">
            {error}
          </div>
        )}
        {notice != null && <div className="inacord-explorer__notice">{notice}</div>}
        <div className="inacord-explorer__content">{children}</div>
        {status != null && <footer className="inacord-explorer__status">{status}</footer>}
        {selectionBar}
      </main>
      {hasInspector && (
        <>
          <div
            className="inacord-explorer__separator"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector"
            onPointerDown={(event) => {
              event.preventDefault();
              dragging.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              document.body.style.setProperty("cursor", "col-resize", "important");
              document.body.style.userSelect = "none";
            }}
            onPointerMove={(event) => {
              if (!dragging.current || !hostRef.current) return;
              const next = hostRef.current.getBoundingClientRect().right - event.clientX;
              setResizedWidth(Math.max(inspectorMinSize, Math.min(inspectorMaxSize, Math.round(next))));
            }}
            onPointerUp={endResize}
          />
          <aside className="inacord-explorer__inspector" aria-label="Inspector">
            {inspectorHeader != null && <div className="inacord-explorer__inspector-header">{inspectorHeader}</div>}
            <div className="inacord-explorer__inspector-body">{inspector}</div>
          </aside>
        </>
      )}
    </section>
  );
}

export interface ExplorerSidebarItem {
  id: string;
  label: string;
  icon?: ReactNode;
  title?: string;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: MouseEventHandler<HTMLButtonElement>;
  onAuxClick?: MouseEventHandler<HTMLButtonElement>;
}

export interface ExplorerSidebarSection {
  label?: string | null;
  items: readonly ExplorerSidebarItem[];
}

export interface ExplorerSidebarProps {
  sections: readonly ExplorerSidebarSection[];
  current?: string;
  onSelect: (id: string) => void;
  footer?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

/** Shared sidebar used by the full Explorer page shell in both hosts. */
export function ExplorerSidebar({ sections, current, onSelect, footer, ariaLabel = "Explorer navigation", className }: ExplorerSidebarProps) {
  return (
    <aside className={joinClassName("inacord-explorer-sidebar", className)} aria-label={ariaLabel}>
      <nav className="inacord-explorer-sidebar__nav">
        <div className="inacord-explorer-sidebar__sections">
          {sections.map((section, sectionIndex) => (
            <section className="inacord-explorer-sidebar__section" key={section.label ?? `section-${sectionIndex}`}>
              {section.label && <h2><GameText>{section.label}</GameText></h2>}
              {section.items.map((item) => {
                const active = item.active ?? item.id === current;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={joinClassName("inacord-explorer-sidebar__item", active && "inacord-explorer-sidebar__item--active")}
                    aria-current={active ? "page" : undefined}
                    title={item.title ?? item.label}
                    onClick={item.onClick ?? (() => onSelect(item.id))}
                    onContextMenu={item.onContextMenu}
                    onAuxClick={item.onAuxClick}
                  >
                    {item.icon != null && <span className="inacord-explorer-sidebar__icon">{item.icon}</span>}
                    <span><GameText>{item.label}</GameText></span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
        {footer != null && <footer className="inacord-explorer-sidebar__footer">{footer}</footer>}
      </nav>
    </aside>
  );
}

export function ExplorerPageShell({ sidebar, children, className }: { sidebar: ReactNode; children: ReactNode; className?: string }) {
  return <div className={joinClassName("inacord-explorer-page", className)}>{sidebar}<div className="inacord-explorer-page__content">{children}</div></div>;
}

export interface ExplorerTabsBarTab {
  id: string;
  prefix: string;
  label?: string;
}

export interface ExplorerTabsBarProps {
  tabs: readonly ExplorerTabsBarTab[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  getLabel?: (tab: ExplorerTabsBarTab) => string;
  newTabLabel?: string;
  closeTabLabel?: (tab: ExplorerTabsBarTab) => string;
  folderIcon?: ReactNode;
  closeIcon?: ReactNode;
  newIcon?: ReactNode;
  className?: string;
}

function defaultTabLabel(tab: ExplorerTabsBarTab): string {
  const segments = tab.prefix.split("/").filter(Boolean);
  return tab.label ?? segments.at(-1) ?? "Root";
}

/** Shared browser-like Explorer tabs, including middle-click close semantics. */
export function ExplorerTabsBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onNew,
  getLabel = defaultTabLabel,
  newTabLabel = "New tab",
  closeTabLabel = (tab) => `Close ${getLabel(tab)}`,
  folderIcon = <span className="material-symbols-rounded">folder</span>,
  closeIcon = <span className="material-symbols-rounded">close</span>,
  newIcon = <span className="material-symbols-rounded">add</span>,
  className,
}: ExplorerTabsBarProps) {
  return (
    <div className={joinClassName("inacord-explorer-tabs", className)} role="tablist" aria-label="Explorer tabs">
      <div className="inacord-explorer-tabs__items">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              className={joinClassName("inacord-explorer-tabs__tab", active && "inacord-explorer-tabs__tab--active")}
              key={tab.id}
              role="presentation"
              onAuxClick={(event) => {
                if (event.button !== 1 || tabs.length <= 1) return;
                event.preventDefault();
                onClose(tab.id);
              }}
            >
              <button
                type="button"
                className="inacord-explorer-tabs__activate"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={tab.prefix || "Root"}
                onClick={() => onActivate(tab.id)}
              >
                <span className="inacord-explorer-tabs__folder" aria-hidden="true">{folderIcon}</span>
                <span className="inacord-explorer-tabs__label">{getLabel(tab)}</span>
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="inacord-explorer-tabs__close"
                  aria-label={closeTabLabel(tab)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  {closeIcon}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="inacord-explorer-tabs__new" aria-label={newTabLabel} title={newTabLabel} onClick={onNew}>
        {newIcon}
      </button>
    </div>
  );
}

export interface ExplorerToolbarProps {
  leading?: ReactNode;
  breadcrumbs: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export function ExplorerToolbar({ leading, breadcrumbs, trailing, className }: ExplorerToolbarProps) {
  return (
    <div className={joinClassName("inacord-explorer-toolbar", className)}>
      {leading != null && <div className="inacord-explorer-toolbar__actions">{leading}</div>}
      <div className="inacord-explorer-toolbar__breadcrumbs">{breadcrumbs}</div>
      {trailing != null && <div className="inacord-explorer-toolbar__actions">{trailing}</div>}
    </div>
  );
}

export interface ExplorerToolbarButtonProps {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
}

export function ExplorerToolbarButton({
  label,
  icon,
  onClick,
  disabled,
  pressed,
  className,
}: ExplorerToolbarButtonProps) {
  return (
    <button
      type="button"
      className={joinClassName("inacord-explorer-toolbar__button", className)}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

export interface ExplorerBreadcrumbsProps {
  segments: readonly string[];
  onNavigate: (prefix: string, index: number) => void;
  rootLabel?: string;
}

export function ExplorerBreadcrumbs({ segments, onNavigate, rootLabel = "Root" }: ExplorerBreadcrumbsProps) {
  return (
    <nav className="inacord-explorer-breadcrumbs" aria-label="Breadcrumb">
      {segments.length === 0 ? (
        <span className="inacord-explorer-breadcrumbs__root">{rootLabel}</span>
      ) : (
        segments.map((segment, index) => (
          <span className="inacord-explorer-breadcrumbs__segment" key={`${segment}-${index}`}>
            <button type="button" onClick={() => onNavigate(segments.slice(0, index + 1).join("/"), index)}>
              {segment}
            </button>
            <span aria-hidden="true">/</span>
          </span>
        ))
      )}
    </nav>
  );
}

export interface ExplorerFiltersProps {
  query: string;
  extension: string;
  onQueryChange: (value: string) => void;
  onExtensionChange: (value: string) => void;
  queryPlaceholder?: string;
  extensionPlaceholder?: string;
}

export function ExplorerFilters({
  query,
  extension,
  onQueryChange,
  onExtensionChange,
  queryPlaceholder = "Search VFS…",
  extensionPlaceholder = "Extension",
}: ExplorerFiltersProps) {
  return (
    <>
      <input
        className="inacord-explorer-filters__query"
        type="search"
        value={query}
        placeholder={queryPlaceholder}
        aria-label={queryPlaceholder}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <input
        className="inacord-explorer-filters__extension"
        value={extension}
        placeholder={extensionPlaceholder}
        aria-label={extensionPlaceholder}
        onChange={(event) => onExtensionChange(event.currentTarget.value)}
      />
    </>
  );
}

export interface ExplorerEntriesProps {
  viewMode: ExplorerViewMode;
  children: ReactNode;
  gridSize?: number;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  ariaLabel?: string;
  className?: string;
}

export const ExplorerEntries = forwardRef<HTMLDivElement, ExplorerEntriesProps>(function ExplorerEntries({
  viewMode,
  children,
  gridSize = 96,
  onKeyDown,
  ariaLabel = "Files and folders",
  className,
}, ref) {
  return (
    <div
      ref={ref}
      className={joinClassName("inacord-explorer-entries", `inacord-explorer-entries--${viewMode}`, className)}
      style={viewMode === "grid" ? ({ "--explorer-grid-size": `${gridSize}px` } as CSSProperties) : undefined}
      role="list"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
});

export interface ExplorerStatusProps {
  primary: ReactNode;
  secondary?: ReactNode;
}

export function ExplorerStatus({ primary, secondary }: ExplorerStatusProps) {
  return (
    <>
      <span>{primary}</span>
      {secondary != null && <span>{secondary}</span>}
    </>
  );
}
