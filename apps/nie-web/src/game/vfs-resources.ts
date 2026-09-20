/** Shared read-only resource mounts. Archive parsing remains owned by Rust. */
export interface VfsMount {
	has(path: string): boolean;
	read(path: string): Uint8Array;
	free(): void;
}

export class VfsResources {
	private readonly mounts = new Map<string, VfsMount>();

	/** Identity check only: an evicted archive may already have freed its Rust allocation. */
	isMounted(id: string, archive: VfsMount): boolean {
		return this.mounts.get(id) === archive;
	}

	/** A verified replacement becomes visible atomically before the old mount is freed. */
	mount(id: string, archive: VfsMount): void {
		for (const [otherId, other] of this.mounts) {
			if (other === archive && otherId !== id) throw new Error("VFS allocation is already mounted under another id");
		}
		const previous = this.mounts.get(id);
		this.mounts.set(id, archive);
		if (previous !== archive) previous?.free();
	}

	read(path: string): Uint8Array | null {
		for (const archive of this.mounts.values()) {
			if (archive.has(path)) return archive.read(path);
		}
		return null;
	}

	unmount(id: string): void {
		const archive = this.mounts.get(id);
		this.mounts.delete(id);
		archive?.free();
	}
}

/** Menu composition, media decoding and Lua all consume these same verified bytes. */
export const vfsResources = new VfsResources();
