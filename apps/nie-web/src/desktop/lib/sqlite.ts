/** Database compatibility facade backed by the shared native SQLite owner. */
import { invoke } from "@tauri-apps/api/core";

export interface QueryResult {
  rowsAffected: number;
  lastInsertId: number;
}

export default class Database {
  constructor(public readonly path: string) {}

  static async load(path: string): Promise<Database> {
    return new Database(await invoke<string>("sqlite_load", { db: path }));
  }

  static get(path: string): Database {
    return new Database(path);
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    return invoke<T>("sqlite_select", { db: this.path, query, values: bindValues });
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<QueryResult> {
    return invoke<QueryResult>("sqlite_execute", { db: this.path, query, values: bindValues });
  }

  // Match the previous plugin: omitted database closes every loaded session.
  async close(db?: string): Promise<boolean> {
    return invoke<boolean>("sqlite_close", { db });
  }
}
