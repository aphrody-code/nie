import { createFrontendConfig } from "../nie-web/vite.config";

// Compatibility facade; direct Vite invocations use the same root and desktop adapter.
export default (environment: Parameters<typeof createFrontendConfig>[0]) =>
	createFrontendConfig({ ...environment, mode: "desktop" });
