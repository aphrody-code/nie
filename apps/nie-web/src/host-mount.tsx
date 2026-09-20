import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Host from "#nie-host";

/** The compatibility mount retained while public screens leave React incrementally. */
export function mountHost(root: HTMLElement): void {
	root.replaceChildren();
	createRoot(root).render(
		<StrictMode>
			<Host />
		</StrictMode>,
	);
}
