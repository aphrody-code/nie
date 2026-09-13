import { useCallback, useEffect, useState } from "react";
import { ensureWasm } from "./bridge";

/** Retryable owner for the core WASM readiness gate. */
export function useWasmReadiness(
	enabled: boolean,
	load: () => Promise<void> = ensureWasm,
): { ready: boolean; failed: boolean; retry: () => void } {
	const [ready, setReady] = useState(!enabled);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		if (!enabled || ready) return;
		let active = true;
		load().then(
			() => {
				if (!active) return;
				setReady(true);
				setFailed(false);
			},
			() => {
				if (active) setFailed(true);
			},
		);
		return () => { active = false; };
	}, [attempt, enabled, load, ready]);

	const retry = useCallback(() => {
		if (!enabled || ready) return;
		setFailed(false);
		setAttempt((value) => value + 1);
	}, [enabled, ready]);

	return { ready, failed, retry };
}
