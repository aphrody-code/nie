import { describe, expect, test } from "bun:test";
import type { OcReference } from "@niers/inacord-ui/avatar/contract";
import { loadOcReference, resolveOcReferenceUrl } from "./oc-reference-loader";

const payload = new TextEncoder().encode("validated OC bytes");
const hash = "40b5085ed773672e36dc42e64443a9a8bc82c10b3d797be36b1bf0c32548f3a5";
const reference = (patch: Partial<OcReference> = {}): OcReference => ({
	kind: "glb", value: "/oc/avatar.glb", bytes: payload.byteLength, sha256: hash, ...patch,
});
const pageUrl = "https://nie.example/avatar";

function response(body: BodyInit, url = "https://nie.example/oc/avatar.glb", headers?: HeadersInit): Response {
	const result = new Response(body, { status: 200, headers });
	Object.defineProperty(result, "url", { value: url });
	return result;
}

describe("OC reference trust boundary", () => {
	test("admits same-origin and the configured asset origin, but no arbitrary or active scheme", () => {
		expect(resolveOcReferenceUrl(reference(), { pageUrl }).origin).toBe("https://nie.example");
		expect(resolveOcReferenceUrl(reference({ value: "data/avatar.glb" }), {
			pageUrl, vfsUrl: (path) => `/f/${path}`,
		}).href).toBe("https://nie.example/f/data/avatar.glb");
		expect(resolveOcReferenceUrl(reference({ value: "https://assets.example/avatar.glb" }), {
			pageUrl, assetSourceUrl: "https://assets.example/f/data/probe",
		}).origin).toBe("https://assets.example");
		for (const value of ["https://evil.example/avatar.glb", "file:///tmp/avatar.glb", "data:model/gltf-binary,xx", "javascript:alert(1)"]) {
			expect(() => resolveOcReferenceUrl(reference({ value }), { pageUrl })).toThrow();
		}
		for (const value of ["data/../secret.glb", "data/foo\\bar.glb", "data/avatar.glb?download=1", "data/avatar.glb#part"]) {
			expect(() => resolveOcReferenceUrl(reference({ value }), {
				pageUrl, vfsUrl: (path) => `/f/${path}`,
			})).toThrow("VFS");
		}
		let invalidVfsMapperCalls = 0;
		for (const value of [
			"data/%2e%2e/secret.glb",
			"data/%2E./secret.glb",
			"data/.%2e/secret.glb",
			"data/%252e%252e/secret.glb",
			"data/%25252e%25252e/secret.glb",
			"data/%2fetc/avatar.glb",
			"data/%255cetc/avatar.glb",
			"data/%2500/avatar.glb",
			"data/avatar.glb%3fdownload=1",
			"data/avatar.glb%23part",
			"data/%25252525252e%25252525252e/secret.glb",
		]) {
			expect(() => resolveOcReferenceUrl(reference({ value }), {
				pageUrl, vfsUrl: (path) => {
					invalidVfsMapperCalls += 1;
					return `/f/${path}`;
				},
			})).toThrow("VFS");
		}
		expect(invalidVfsMapperCalls).toBe(0);
		expect(() => resolveOcReferenceUrl(reference({ value: "data/avatar.glb" }), {
			pageUrl,
			vfsUrl: (path) => path === "data/__oc_vfs_root_probe__" ? "/f/data/probe" : "/private/avatar.glb",
		})).toThrow("préfixe VFS");
	});

	test("rejects a simulated cross-origin redirect before reading its body", async () => {
		let cancelled = false;
		const body = new ReadableStream({
			pull(controller) { controller.enqueue(payload); },
			cancel() { cancelled = true; },
		});
		let redirectMode: RequestRedirect | undefined;
		await expect(loadOcReference(reference(), {
			pageUrl,
			fetcher: async (_url, init) => {
				redirectMode = init?.redirect;
				return response(body, "https://evil.example/avatar.glb");
			},
		})).rejects.toThrow("redirection");
		expect(redirectMode).toBe("error");
		expect(cancelled).toBe(true);
	});

	test("stops a chunked response as soon as it crosses the cap", async () => {
		const chunk = new Uint8Array(20 * 1024 * 1024);
		let reads = 0;
		const body = new ReadableStream({ pull(controller) {
			reads += 1;
			controller.enqueue(chunk);
			if (reads === 4) controller.close();
		} });
		await expect(loadOcReference(reference({ bytes: 1, sha256: "a".repeat(64) }), {
			pageUrl,
			fetcher: async () => response(body),
		})).rejects.toThrow("borne");
		expect(reads).toBeLessThanOrEqual(4);
	});

	test("checks declared byte length and SHA-256 before returning bytes", async () => {
		await expect(loadOcReference(reference({ bytes: undefined }), {
			pageUrl, fetcher: async () => response(payload),
		})).rejects.toThrow("taille valide");
		await expect(loadOcReference(reference(), {
			pageUrl, fetcher: async () => response(payload, undefined, { "content-length": String(65 * 1024 * 1024) }),
		})).rejects.toThrow("borne");
		await expect(loadOcReference(reference({ bytes: payload.byteLength + 1 }), {
			pageUrl, fetcher: async () => response(payload),
		})).rejects.toThrow("Taille OC incorrecte");
		await expect(loadOcReference(reference({ sha256: "a".repeat(64) }), {
			pageUrl, fetcher: async () => response(payload),
		})).rejects.toThrow("SHA-256");
		expect(await loadOcReference(reference(), {
			pageUrl, fetcher: async () => response(payload, undefined, { "content-length": String(payload.byteLength) }),
		})).toMatchObject({ bytes: payload, name: "avatar.glb" });
	});
});
