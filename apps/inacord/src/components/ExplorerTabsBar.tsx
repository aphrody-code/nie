import {
  ExplorerTabsBar as SharedExplorerTabsBar,
  type ExplorerTabsBarProps as SharedExplorerTabsBarProps,
} from "@niers/inacord-ui/explorer/explorer-surface";
import { Icon } from "@niers/inacord-ui/components/ui/Icon";

import type { ExplorerTab } from "@/lib/explorerTabs";

/** Label shared by the desktop and browser Explorer tab bars. */
export function tabLabel(prefix: string): string {
  return prefix.split("/").pop() || prefix || "Racine";
}

/** Thin desktop state binding over the shared Explorer tab presentation. */
export function ExplorerTabsBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onNew,
}: {
  tabs: ExplorerTab[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const props: SharedExplorerTabsBarProps = {
    tabs,
    activeId,
    onActivate,
    onClose,
    onNew,
    getLabel: (tab) => tabLabel(tab.prefix),
    newTabLabel: "Nouvel onglet (Ctrl+T)",
    closeTabLabel: (tab) => `Fermer l'onglet ${tabLabel(tab.prefix)}`,
    folderIcon: <Icon name="folder" size={13} />,
    closeIcon: <Icon name="close" size={12} />,
    newIcon: <Icon name="add" size={14} />,
  };

  return (
    <div className="inacord-explorer__tabs">
      <SharedExplorerTabsBar {...props} />
    </div>
  );
}
