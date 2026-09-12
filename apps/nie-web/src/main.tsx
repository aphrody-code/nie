import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Host from "#nie-host";

// A deployment replaces every hashed chunk under `static/`. A tab that loaded the previous
// `index.html` then fails its next lazy import with a 404 and shows "unavailable" screens until
// someone hard-reloads. Vite reports that exact failure; one reload per session fixes it.
window.addEventListener("vite:preloadError", (event) => {
	const key = "nie:reload-after-preload-error";
	if (sessionStorage.getItem(key)) return;
	sessionStorage.setItem(key, "1");
	event.preventDefault();
	window.location.reload();
});

const rootElement = document.getElementById("racine");
if (!rootElement) throw new Error("#racine absent de index.html");
createRoot(rootElement).render(
	<StrictMode>
		<Host />
	</StrictMode>,
);
