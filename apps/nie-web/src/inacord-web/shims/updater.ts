import { unavailable } from "./native-error";
export interface Update { version: string; body?: string; date?: string; downloadAndInstall(): Promise<void>; close(): Promise<void>; }
export async function check(): Promise<Update | null> { throw unavailable("La mise à jour intégrée"); }
