import { unavailable } from "./native-error";
export async function readText(): Promise<string> { throw unavailable("Le presse-papiers natif"); }
export async function writeText(_text: string): Promise<void> { throw unavailable("Le presse-papiers natif"); }
