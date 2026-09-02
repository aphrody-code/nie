"use client";

import type { ReactNode } from "react";

export function ActionsWrapper({ children }: { children: ReactNode }) {
	return (
		<div
			className="border-t bg-surface-container-low/50 px-4 py-1.5 flex items-center justify-between gap-4"
			role="contentinfo"
			aria-label="Actions de l'éditeur"
		>
			{children}
		</div>
	);
}
