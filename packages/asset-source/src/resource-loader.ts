/** Bounded demand/preload queue. Original VFS identities stay with the caller; URLs are bindings. */
export class ResourceLoader {
	private readonly pending = new Map<string, Promise<Blob>>();
	private readonly retained = new Map<string, Blob>();
	private readonly queue: Array<{ url: string; run: () => void }> = [];
	private readonly abort = new AbortController();
	private active = 0;
	private bytes = 0;
	private disposed = false;

	constructor(private readonly concurrency = 4, private readonly byteBudget = 64 * 1024 * 1024) {
		if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(byteBudget) || byteBudget < 0) throw new Error("Invalid resource budget");
	}

	/** Demand jobs run before queued speculation. Failures are never cached as successful assets. */
	load(url: string, priority: "demand" | "preload" = "demand"): Promise<Blob> {
		if (this.disposed) return Promise.reject(new Error("Resource loader disposed"));
		const cached = this.retained.get(url);
		if (cached) {
			this.retained.delete(url);
			this.retained.set(url, cached);
			return Promise.resolve(cached);
		}
		const pending = this.pending.get(url);
		if (pending) {
			if (priority === "demand") {
				const index = this.queue.findIndex(job => job.url === url);
				if (index > 0) this.queue.unshift(...this.queue.splice(index, 1));
			}
			return pending;
		}
		const job = new Promise<Blob>((resolve, reject) => {
			const run = () => {
				this.active++;
				fetch(url, { signal: this.abort.signal }).then(async (response) => {
					if (!response.ok) throw new Error("Resource unavailable");
					const blob = await response.blob();
					if (!blob.size) throw new Error("Empty resource");
					if (!this.disposed && blob.size <= this.byteBudget) {
						while (this.bytes + blob.size > this.byteBudget) {
							const first = this.retained.entries().next().value;
							if (!first) break;
							this.retained.delete(first[0]);
							this.bytes -= first[1].size;
						}
						this.retained.set(url, blob);
						this.bytes += blob.size;
					}
					resolve(blob);
				}).catch(reject).finally(() => {
					this.pending.delete(url);
					this.active--;
					this.drain();
				});
			};
			if (priority === "demand") this.queue.unshift({ url, run });
			else this.queue.push({ url, run });
		});
		this.pending.set(url, job);
		this.drain();
		return job;
	}

	private drain() {
		while (this.active < this.concurrency && this.queue.length) this.queue.shift()?.run();
	}

	dispose() {
		this.disposed = true;
		this.abort.abort();
		this.retained.clear();
		this.bytes = 0;
		// Queued requests also run against the aborted signal, settling every waiting consumer.
		this.drain();
	}
}
