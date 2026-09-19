/**
 * Client-Side Virtual File System (VFS) for offline / local-first execution of nie.exe in WASM.
 *
 * Supports:
 * - Direct byte registration by normalized path and CRC-32 hash.
 * - Mounting Level-5 CPK archives in-memory using nie-wasm (cpk_parse_entries, cpk_extract_file).
 * - Mounting local Steam installation or game folder via File System Access API (showDirectoryPicker)
 *   or drag-and-drop.
 */
import { cpk_parse_entries, cpk_extract_file, crc32 as wasmCrc32 } from "../wasm/nie_wasm.js";
import { ensureWasm } from "./bridge";

export interface VfsEntry {
	readonly path: string;
	readonly size: number;
	readonly crc32: number;
	readonly bytes?: Uint8Array;
}

export interface CpkEntryHeader {
	id: number;
	name: string;
	offset: number;
	size: number;
	compressed_size: number;
}

export class OfflineVfs {
	private readonly files = new Map<string, Uint8Array>();
	private readonly crcIndex = new Map<number, Uint8Array>();
	private readonly directoryHandles = new Map<string, FileSystemFileHandle>();
	private readonly listeners = new Set<() => void>();

	/** Normalized VFS path: forward slashes, lowercased drive letters, no leading/trailing slashes. */
	public normalizePath(path: string): string {
		return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
	}

	/** Safely calculates CRC-32 without crashing if WASM is not yet initialized. */
	private safeCrc32(path: string): number | null {
		try {
			return wasmCrc32(path);
		} catch {
			return null;
		}
	}

	/** Registers raw file bytes into the in-memory VFS. */
	public registerFile(rawPath: string, bytes: Uint8Array): void {
		const path = this.normalizePath(rawPath);
		this.files.set(path, bytes);
		const hash = this.safeCrc32(path);
		if (hash !== null) {
			this.crcIndex.set(hash, bytes);
		}
		this.notify();
	}

	/** Retrieves file bytes by exact VFS path. */
	public getFile(rawPath: string): Uint8Array | null {
		const path = this.normalizePath(rawPath);
		const inMemory = this.files.get(path);
		if (inMemory) return inMemory;
		return null;
	}

	/** Retrieves file bytes asynchronously (reading from FileSystemFileHandle if mounted). */
	public async fetchFile(rawPath: string): Promise<Uint8Array | null> {
		const immediate = this.getFile(rawPath);
		if (immediate) return immediate;

		const path = this.normalizePath(rawPath);
		const handle = this.directoryHandles.get(path);
		if (handle) {
			try {
				const file = await handle.getFile();
				const buffer = new Uint8Array(await file.arrayBuffer());
				this.registerFile(path, buffer);
				return buffer;
			} catch (err) {
				console.warn(`[offline-vfs] Failed to read mounted file ${path}:`, err);
			}
		}
		return null;
	}

	/** Checks if a file exists in the VFS. */
	public hasFile(rawPath: string): boolean {
		const path = this.normalizePath(rawPath);
		return this.files.has(path) || this.directoryHandles.has(path);
	}

	/** Retrieves file bytes by CRC-32 hash. */
	public getByHash(hash: number): Uint8Array | null {
		const direct = this.crcIndex.get(hash);
		if (direct) return direct;
		for (const [path, bytes] of this.files) {
			const calculated = this.safeCrc32(path);
			if (calculated !== null) {
				this.crcIndex.set(calculated, bytes);
				if (calculated === hash) return bytes;
			}
		}
		return null;
	}

	/** Total count of registered files. */
	public get count(): number {
		return this.files.size + this.directoryHandles.size;
	}

	/** List of all registered paths. */
	public getPaths(): string[] {
		const all = new Set<string>([...this.files.keys(), ...this.directoryHandles.keys()]);
		return Array.from(all);
	}

	/** Mounts a CPK archive into the VFS, extracting and indexing all contained files. */
	public async mountCpk(archiveName: string, cpkBytes: Uint8Array): Promise<number> {
		await ensureWasm();
		const json = cpk_parse_entries(cpkBytes, archiveName);
		const entries = JSON.parse(json) as { files: CpkEntryHeader[] };
		let loaded = 0;

		for (const entry of entries.files || []) {
			try {
				const extracted = cpk_extract_file(cpkBytes, archiveName, JSON.stringify(entry));
				const path = `data/${entry.name}`;
				this.registerFile(path, extracted);
				loaded++;
			} catch (err) {
				console.warn(`[offline-vfs] Failed to extract ${entry.name} from ${archiveName}:`, err);
			}
		}
		return loaded;
	}

	/**
	 * Recursively scans and mounts a directory handle from showDirectoryPicker().
	 */
	public async mountDirectoryHandle(dirHandle: FileSystemDirectoryHandle, prefix = ""): Promise<number> {
		let count = 0;
		for await (const [name, handle] of (dirHandle as any).entries()) {
			const currentPath = prefix ? `${prefix}/${name}` : name;
			if (handle.kind === "file") {
				this.directoryHandles.set(this.normalizePath(currentPath), handle as FileSystemFileHandle);
				count++;
			} else if (handle.kind === "directory") {
				count += await this.mountDirectoryHandle(handle as FileSystemDirectoryHandle, currentPath);
			}
		}
		this.notify();
		return count;
	}

	/** Subscribes to VFS changes. */
	public subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (err) {
				console.error("[offline-vfs] Listener error:", err);
			}
		}
	}
}

/** Global shared instance of the Offline VFS. */
export const offlineVfs = new OfflineVfs();
