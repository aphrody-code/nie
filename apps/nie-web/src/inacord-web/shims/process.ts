import { unavailable } from "./native-error";
export async function relaunch(): Promise<void> { throw unavailable("Le redémarrage natif"); }
