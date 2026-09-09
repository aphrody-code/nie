import { unavailable } from "./native-error";
export async function openUrl(url: string): Promise<void> { window.open(url, "_blank", "noopener,noreferrer"); }
export async function openPath(_path: string): Promise<void> { throw unavailable("L’ouverture de fichiers locaux"); }
export async function revealItemInDir(_path: string): Promise<void> { throw unavailable("L’explorateur de fichiers natif"); }
