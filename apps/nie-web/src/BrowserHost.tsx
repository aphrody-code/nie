/**
 * The browser host — the application, with the resources the origin serves.
 *
 * It provides three things and nothing else: the stylesheet, the theme class that `next-themes`
 * writes on `<html>`, and a boundary so a crash in one screen does not leave a blank document.
 * The source is the web one (`creerWebSource`), built by `App` itself when no host supplies one.
 */
import { ThemeProvider } from "next-themes";
import { App } from "./App";
import { ErrorBoundary } from "./desktop/components/ErrorBoundary";
import "./app.css";

export default function BrowserHost() {
	return (
		<ErrorBoundary zone="Application">
			<ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
				<App />
			</ThemeProvider>
		</ErrorBoundary>
	);
}
