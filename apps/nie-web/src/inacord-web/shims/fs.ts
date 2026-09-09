import { unavailable } from "./native-error";
export enum BaseDirectory { AppData = 22 }
const reject = async () => { throw unavailable("Le système de fichiers natif"); };
export const copyFile = reject; export const mkdir = reject; export const remove = reject; export const stat = reject; export const writeFile = reject;
export async function exists(): Promise<boolean> { return false; }
