import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Host from "#nie-host";

const rootElement = document.getElementById("racine");
if (!rootElement) throw new Error("#racine absent de index.html");
createRoot(rootElement).render(
	<StrictMode>
		<Host />
	</StrictMode>,
);
