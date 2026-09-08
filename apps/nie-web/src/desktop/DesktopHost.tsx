import { ThemeProvider } from "next-themes";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

/** Native services and window chrome for the shared frontend entry. */
export default function DesktopHost() {
  return <ErrorBoundary zone="Application"><ThemeProvider attribute="class" defaultTheme="dark" enableSystem><App /></ThemeProvider></ErrorBoundary>;
}
