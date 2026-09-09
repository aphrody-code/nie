import { unavailable } from "./native-error";
export async function tempDir(): Promise<string> { throw unavailable("Le dossier temporaire natif"); }
export async function videoDir(): Promise<string> { throw unavailable("Le dossier vidéo natif"); }
export async function join(...parts: string[]): Promise<string> { return parts.join("/"); }
