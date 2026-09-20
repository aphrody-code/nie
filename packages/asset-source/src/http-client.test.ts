import { describe, expect, test, mock } from "bun:test";
import { fetchJson, fetchBytes, preflightHead, HttpError, extractErrorMessage } from "./http-client";

describe("http-client", () => {
	test("extractErrorMessage handles structured server json", async () => {
		const res = new Response(JSON.stringify({ erreur: "ressource absente du VFS" }), {
			status: 404,
			statusText: "Not Found",
			headers: { "content-type": "application/json" },
		});
		const { message, details } = await extractErrorMessage(res, "/api/v1/f/test");
		expect(message).toBe("/api/v1/f/test → 404 (ressource absente du VFS)");
		expect(details).toEqual({ erreur: "ressource absente du VFS" });
	});

	test("extractErrorMessage handles plain text", async () => {
		const res = new Response("GET, HEAD, OPTIONS uniquement", {
			status: 405,
			statusText: "Method Not Allowed",
			headers: { "content-type": "text/plain" },
		});
		const { message } = await extractErrorMessage(res, "/model/test");
		expect(message).toBe("/model/test → 405 (GET, HEAD, OPTIONS uniquement)");
	});

	test("fetchJson succeeds and returns parsed data", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			return new Response(JSON.stringify({ api: "nie-site", ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;

		try {
			const data = await fetchJson<{ api: string; ok: boolean }>("/api/v1/health", { retries: 0 });
			expect(data.api).toBe("nie-site");
			expect(data.ok).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("fetchJson retries on transient 503 and succeeds", async () => {
		let attempts = 0;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			attempts++;
			if (attempts === 1) {
				return new Response(JSON.stringify({ erreur: "catalogue en cours de montage" }), {
					status: 503,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(JSON.stringify({ total: 42 }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;

		try {
			const data = await fetchJson<{ total: number }>("/api/v1/chara", {
				retries: 2,
				retryDelayMs: 10,
			});
			expect(attempts).toBe(2);
			expect(data.total).toBe(42);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("fetchJson throws typed HttpError with server message when exhausted", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			return new Response(JSON.stringify({ erreur: "panique interceptee" }), {
				status: 500,
				statusText: "Internal Server Error",
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;

		try {
			await fetchJson("/api/v1/fail", { retries: 0 });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err instanceof HttpError).toBe(true);
			const httpErr = err as HttpError;
			expect(httpErr.status).toBe(500);
			expect(httpErr.message).toContain("panique interceptee");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("fetchBytes enforces maximum byte limit via content-length header", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			return new Response(new Uint8Array(2000), {
				status: 200,
				headers: { "content-length": "2000" },
			});
		}) as unknown as typeof fetch;

		try {
			await fetchBytes("/model/huge.glb", 1000, { retries: 0 });
			expect.unreachable("should have thrown limit error");
		} catch (err) {
			expect(err instanceof HttpError).toBe(true);
			expect((err as HttpError).message).toContain("Payload size exceeds limit");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("fetchBytes succeeds when within byte limit", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			return new Response(new Uint8Array([1, 2, 3, 4]), {
				status: 200,
				headers: { "content-length": "4" },
			});
		}) as unknown as typeof fetch;

		try {
			const bytes = await fetchBytes("/model/small.glb", 1000, { retries: 0 });
			expect(bytes.length).toBe(4);
			expect(bytes[0]).toBe(1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("fetchBytes succeeds when called with options as second argument", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			return new Response(new Uint8Array([5, 6, 7]), {
				status: 200,
			});
		}) as unknown as typeof fetch;

		try {
			const bytes = await fetchBytes("/model/test.bin", { timeoutMs: 5000, retries: 0 });
			expect(bytes.length).toBe(3);
			expect(bytes[0]).toBe(5);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("preflightHead correctly extracts headers without body", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			expect(init?.method).toBe("HEAD");
			return new Response(null, {
				status: 200,
				headers: {
					"content-length": "12345",
					"content-type": "model/gltf-binary",
				},
			});
		}) as unknown as typeof fetch;

		try {
			const info = await preflightHead("/model/test.glb", { retries: 0 });
			expect(info.ok).toBe(true);
			expect(info.status).toBe(200);
			expect(info.contentLength).toBe(12345);
			expect(info.contentType).toBe("model/gltf-binary");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
