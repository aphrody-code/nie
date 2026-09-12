/**
 * WebGL 2 fallback for the shared model viewport.
 *
 * `WebGpuViewer` is the reference renderer, but headless Chromium and every browser without
 * WebGPU rejected it with no second path, so `/avatar` presented an empty canvas and the GLB was
 * never even requested. This module implements the same `RustModelViewer` contract on WebGL 2:
 * it consumes the very GLB that `nie-model-serve` assembles (world-space positions, PNG textures
 * embedded in the buffer), so nothing here re-derives geometry — it only draws what Rust built.
 *
 * Deliberately unlit and unskinned: the served avatar GLB is already posed and already carries
 * its baked base-colour textures.
 */
import type { RustModelViewer } from "@niers/inacord-ui/shell/rust-model-viewport";

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

interface GltfAccessor { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; }
interface GltfBufferView { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; }
interface GltfImage { bufferView?: number; mimeType?: string; uri?: string; }
interface GltfPrimitive { attributes: Record<string, number>; indices?: number; material?: number; mode?: number; }
interface GltfMaterial { pbrMetallicRoughness?: { baseColorTexture?: { index: number }; baseColorFactor?: number[] } }
interface GltfDocument {
	accessors?: GltfAccessor[];
	bufferViews?: GltfBufferView[];
	images?: GltfImage[];
	materials?: GltfMaterial[];
	meshes?: { primitives: GltfPrimitive[] }[];
	textures?: { source?: number }[];
}

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

const VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec2 uv;
uniform mat4 mvp;
out vec2 v_uv;
void main() { v_uv = uv; gl_Position = mvp * vec4(position, 1.0); }`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D base_colour;
uniform float has_texture;
uniform vec4 tint;
out vec4 colour;
void main() {
	vec4 sampled = texture(base_colour, v_uv);
	vec4 value = mix(tint, sampled * tint, has_texture);
	if (value.a < 0.02) discard;
	colour = value;
}`;

/** Splits a `.glb` container into its JSON document and its binary chunk. */
export function parseGlbContainer(bytes: Uint8Array): { document: GltfDocument; binary: Uint8Array<ArrayBuffer> } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength < 12 || view.getUint32(0, true) !== MAGIC) throw new Error("Not a GLB container");
	let offset = 12;
	let document: GltfDocument | null = null;
	let binary = new Uint8Array(new ArrayBuffer(0));
	while (offset + 8 <= bytes.byteLength) {
		const length = view.getUint32(offset, true);
		const kind = view.getUint32(offset + 4, true);
		const start = offset + 8;
		if (start + length > bytes.byteLength) break;
		if (kind === JSON_CHUNK) document = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length))) as GltfDocument;
		else if (kind === BIN_CHUNK) binary = new Uint8Array(bytes.subarray(start, start + length).slice().buffer);
		offset = start + length + ((4 - (length % 4)) % 4);
	}
	if (!document) throw new Error("GLB without a JSON chunk");
	return { document, binary };
}

function readAccessor(doc: GltfDocument, binary: Uint8Array<ArrayBuffer>, index: number): { data: Float32Array | Uint32Array; components: number } {
	const accessor = doc.accessors?.[index];
	if (!accessor) throw new Error(`Missing accessor ${index}`);
	const components = TYPE_COMPONENTS[accessor.type] ?? 1;
	const bytes = COMPONENT_BYTES[accessor.componentType] ?? 4;
	const view = accessor.bufferView === undefined ? undefined : doc.bufferViews?.[accessor.bufferView];
	const base = (view?.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	const stride = view?.byteStride && view.byteStride > 0 ? view.byteStride : components * bytes;
	const source = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
	const integral = accessor.componentType !== 5126;
	const out = integral ? new Uint32Array(accessor.count * components) : new Float32Array(accessor.count * components);
	for (let i = 0; i < accessor.count; i += 1) {
		for (let c = 0; c < components; c += 1) {
			const at = base + i * stride + c * bytes;
			if (at + bytes > binary.byteLength) continue;
			let value: number;
			switch (accessor.componentType) {
				case 5120: value = source.getInt8(at); break;
				case 5121: value = source.getUint8(at); break;
				case 5122: value = source.getInt16(at, true); break;
				case 5123: value = source.getUint16(at, true); break;
				case 5125: value = source.getUint32(at, true); break;
				default: value = source.getFloat32(at, true); break;
			}
			out[i * components + c] = value;
		}
	}
	return { data: out, components };
}

interface DrawCall {
	vao: WebGLVertexArrayObject;
	count: number;
	indexType: number;
	texture: WebGLTexture | null;
	tint: [number, number, number, number];
}

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
	const shader = gl.createShader(kind);
	if (!shader) throw new Error("WebGL shader allocation failed");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader) ?? "";
		gl.deleteShader(shader);
		throw new Error(`WebGL shader rejected: ${log}`);
	}
	return shader;
}

/** Column-major 4×4 product, GL order. */
function multiply(a: Float32Array, b: Float32Array): Float32Array {
	const out = new Float32Array(16);
	for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
		let sum = 0;
		for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
		out[c * 4 + r] = sum;
	}
	return out;
}

export class WebGlModelViewer implements RustModelViewer {
	private readonly gl: WebGL2RenderingContext;
	private readonly program: WebGLProgram;
	private readonly white: WebGLTexture;
	private draws: DrawCall[] = [];
	private centre: [number, number, number] = [0, 0, 0];
	private radius = 1;
	private camera = { yaw: 0, pitch: 0, distance: 3.1 };
	private width = 640;
	private height = 720;
	private generation = 0;
	private disposed = false;

	constructor(canvas: HTMLCanvasElement, transparent: boolean) {
		const gl = canvas.getContext("webgl2", { alpha: transparent, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
		if (!gl) throw new Error("WebGL 2 unavailable");
		this.gl = gl;
		const program = gl.createProgram();
		if (!program) throw new Error("WebGL program allocation failed");
		const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
		const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.bindAttribLocation(program, 0, "position");
		gl.bindAttribLocation(program, 1, "uv");
		gl.linkProgram(program);
		gl.deleteShader(vertex);
		gl.deleteShader(fragment);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`WebGL program rejected: ${gl.getProgramInfoLog(program) ?? ""}`);
		this.program = program;
		const white = gl.createTexture();
		if (!white) throw new Error("WebGL texture allocation failed");
		gl.bindTexture(gl.TEXTURE_2D, white);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
		this.white = white;
	}

	load_glb(bytes: Uint8Array): void {
		const gl = this.gl;
		const { document, binary } = parseGlbContainer(bytes);
		this.releaseDraws();
		const generation = (this.generation += 1);
		const min: [number, number, number] = [Infinity, Infinity, Infinity];
		const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
		const pending: { draw: DrawCall; image: number }[] = [];
		for (const mesh of document.meshes ?? []) {
			for (const primitive of mesh.primitives) {
				if (primitive.mode !== undefined && primitive.mode !== 4) continue;
				const positionIndex = primitive.attributes.POSITION;
				if (positionIndex === undefined) continue;
				const positions = readAccessor(document, binary, positionIndex).data as Float32Array;
				for (let i = 0; i + 2 < positions.length; i += 3) {
					for (let axis = 0; axis < 3; axis += 1) {
						const value = positions[i + axis] ?? 0;
						if (value < (min[axis] ?? Infinity)) min[axis] = value;
						if (value > (max[axis] ?? -Infinity)) max[axis] = value;
					}
				}
				const uvIndex = primitive.attributes.TEXCOORD_0;
				const uvs = uvIndex === undefined ? new Float32Array((positions.length / 3) * 2) : readAccessor(document, binary, uvIndex).data as Float32Array;
				const vao = gl.createVertexArray();
				if (!vao) continue;
				gl.bindVertexArray(vao);
				const positionBuffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
				gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
				gl.enableVertexAttribArray(0);
				gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
				const uvBuffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
				gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
				gl.enableVertexAttribArray(1);
				gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
				let count = positions.length / 3;
				let indexType = 0;
				if (primitive.indices !== undefined) {
					const indices = readAccessor(document, binary, primitive.indices).data as Uint32Array;
					const elementBuffer = gl.createBuffer();
					gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
					gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
					count = indices.length;
					indexType = gl.UNSIGNED_INT;
				}
				gl.bindVertexArray(null);
				const material = primitive.material === undefined ? undefined : document.materials?.[primitive.material];
				const factor = material?.pbrMetallicRoughness?.baseColorFactor;
				const draw: DrawCall = {
					vao,
					count,
					indexType,
					texture: null,
					tint: [factor?.[0] ?? 1, factor?.[1] ?? 1, factor?.[2] ?? 1, factor?.[3] ?? 1],
				};
				this.draws.push(draw);
				const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
				const imageIndex = textureIndex === undefined ? undefined : document.textures?.[textureIndex]?.source;
				if (imageIndex !== undefined) pending.push({ draw, image: imageIndex });
			}
		}
		if (Number.isFinite(min[0]) && Number.isFinite(max[0])) {
			this.centre = [((min[0] + max[0]) / 2), ((min[1] + max[1]) / 2), ((min[2] + max[2]) / 2)];
			this.radius = Math.max(1e-3, Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
		}
		void this.uploadTextures(document, binary, pending, generation);
	}

	private async uploadTextures(document: GltfDocument, binary: Uint8Array<ArrayBuffer>, pending: { draw: DrawCall; image: number }[], generation: number) {
		const cache = new Map<number, WebGLTexture | null>();
		for (const { draw, image } of pending) {
			if (this.disposed || generation !== this.generation) return;
			let texture = cache.get(image);
			if (texture === undefined) {
				texture = await this.decodeImage(document, binary, image);
				cache.set(image, texture);
			}
			if (this.disposed || generation !== this.generation) return;
			draw.texture = texture;
			// The host only redraws on camera or size changes: without this the model would keep
			// the untextured frame it was first presented with.
			this.render();
		}
	}

	private async decodeImage(document: GltfDocument, binary: Uint8Array<ArrayBuffer>, index: number): Promise<WebGLTexture | null> {
		const image = document.images?.[index];
		if (!image || image.bufferView === undefined || typeof createImageBitmap !== "function") return null;
		const view = document.bufferViews?.[image.bufferView];
		if (!view) return null;
		const slice = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
		try {
			const bitmap = await createImageBitmap(new Blob([slice], { type: image.mimeType ?? "image/png" }));
			const gl = this.gl;
			const texture = gl.createTexture();
			if (!texture) return null;
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
			gl.generateMipmap(gl.TEXTURE_2D);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			bitmap.close();
			return texture;
		} catch { return null; }
	}

	orbit(yaw: number, pitch: number, distance: number): void {
		if (![yaw, pitch, distance].every(Number.isFinite) || distance <= 0) return;
		this.camera = { yaw, pitch, distance };
	}

	resize(width: number, height: number): void {
		if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return;
		this.width = width;
		this.height = height;
		this.gl.canvas.width = width;
		this.gl.canvas.height = height;
	}

	render(): boolean {
		if (this.disposed || this.draws.length === 0) return false;
		const gl = this.gl;
		gl.viewport(0, 0, this.width, this.height);
		gl.clearColor(0, 0, 0, 0);
		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.useProgram(this.program);
		const mvp = this.matrix();
		gl.uniformMatrix4fv(gl.getUniformLocation(this.program, "mvp"), false, mvp);
		const textureUniform = gl.getUniformLocation(this.program, "base_colour");
		const hasTexture = gl.getUniformLocation(this.program, "has_texture");
		const tint = gl.getUniformLocation(this.program, "tint");
		gl.uniform1i(textureUniform, 0);
		gl.activeTexture(gl.TEXTURE0);
		for (const draw of this.draws) {
			gl.bindTexture(gl.TEXTURE_2D, draw.texture ?? this.white);
			gl.uniform1f(hasTexture, draw.texture ? 1 : 0);
			gl.uniform4f(tint, ...draw.tint);
			gl.bindVertexArray(draw.vao);
			if (draw.indexType) gl.drawElements(gl.TRIANGLES, draw.count, draw.indexType, 0);
			else gl.drawArrays(gl.TRIANGLES, 0, draw.count);
		}
		gl.bindVertexArray(null);
		return true;
	}

	/** Perspective × look-at, with `distance` counted in model radii, exactly like the WebGPU path. */
	private matrix(): Float32Array {
		const { yaw, pitch, distance } = this.camera;
		const eyeDistance = distance * this.radius;
		const [cx, cy, cz] = this.centre;
		const eye: [number, number, number] = [
			cx + eyeDistance * Math.cos(pitch) * Math.sin(yaw),
			cy + eyeDistance * Math.sin(pitch),
			cz + eyeDistance * Math.cos(pitch) * Math.cos(yaw),
		];
		const forward = normalise([cx - eye[0], cy - eye[1], cz - eye[2]]);
		const right = normalise(cross(forward, [0, 1, 0]));
		const up = cross(right, forward);
		const view = new Float32Array([
			right[0], up[0], -forward[0], 0,
			right[1], up[1], -forward[1], 0,
			right[2], up[2], -forward[2], 0,
			-dot(right, eye), -dot(up, eye), dot(forward, eye), 1,
		]);
		const aspect = this.width / Math.max(1, this.height);
		const near = Math.max(1e-3, eyeDistance - this.radius * 4);
		const far = eyeDistance + this.radius * 8;
		const f = 1 / Math.tan(Math.PI / 8);
		const projection = new Float32Array([
			f / aspect, 0, 0, 0,
			0, f, 0, 0,
			0, 0, (far + near) / (near - far), -1,
			0, 0, (2 * far * near) / (near - far), 0,
		]);
		return multiply(projection, view);
	}

	private releaseDraws() {
		for (const draw of this.draws) {
			this.gl.deleteVertexArray(draw.vao);
			if (draw.texture) this.gl.deleteTexture(draw.texture);
		}
		this.draws = [];
	}

	free(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation += 1;
		this.releaseDraws();
		this.gl.deleteTexture(this.white);
		this.gl.deleteProgram(this.program);
	}
}

function normalise(v: [number, number, number]): [number, number, number] {
	const length = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / length, v[1] / length, v[2] / length];
}
function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: [number, number, number], b: [number, number, number]): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
