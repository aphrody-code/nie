"use client";

import { useRouter } from "../../../compat/next";
import { PullToRefresh as SharedPullToRefresh } from "../../ui/pull-to-refresh";
import type { ReactNode } from "react";

/** Wiki navigation supplies refresh; the shared component owns gesture geometry and state. */
export function PullToRefresh({ children }: { children: ReactNode }) {
	const router = useRouter();
	return <SharedPullToRefresh onRafraichir={() => router.refresh()}>{children}</SharedPullToRefresh>;
}
