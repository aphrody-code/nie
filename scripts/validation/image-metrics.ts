/** Gaussian-window SSIM: Wang et al. (2004), 11×11 window, sigma 1.5, 8-bit luminance.
 * Extracted from gate-zukan so menu and model comparisons share the same implementation.
 * Do not replace this with ImageMagick compare -metric SSIM: the local installation
 * returned zero for identical images. Analytic identity/luminance tests guard this implementation. */

function convolve(src: Float64Array, w: number, h: number, kernel: Float64Array): Float64Array {
	const r = (kernel.length - 1) / 2;
	const tmp = new Float64Array(w * h);
	const out = new Float64Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let s = 0;
			for (let k = -r; k <= r; k++) {
				const xx = Math.min(w - 1, Math.max(0, x + k));
				s += src[y * w + xx]! * kernel[k + r]!;
			}
			tmp[y * w + x] = s;
		}
	}
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let s = 0;
			for (let k = -r; k <= r; k++) {
				const yy = Math.min(h - 1, Math.max(0, y + k));
				s += tmp[yy * w + x]! * kernel[k + r]!;
			}
			out[y * w + x] = s;
		}
	}
	return out;
}


export function grayscaleSsim(a: Uint8Array, b: Uint8Array, width: number, height = width): number {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || a.length !== width * height || b.length !== width * height) throw new Error("SSIM requires equal nonempty grayscale images matching the dimensions");
	const n = width * height;
	const fa = new Float64Array(n);
	const fb = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		fa[i] = a[i]!;
		fb[i] = b[i]!;
	}
	const sigma = 1.5;
	const radius = 5;
	const kernel = new Float64Array(2 * radius + 1);
	let sum = 0;
	for (let k = -radius; k <= radius; k++) {
		const v = Math.exp(-(k * k) / (2 * sigma * sigma));
		kernel[k + radius] = v;
		sum += v;
	}
	for (let i = 0; i < kernel.length; i++) kernel[i]! /= sum;

	const faa = new Float64Array(n);
	const fbb = new Float64Array(n);
	const fab = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		faa[i] = fa[i]! * fa[i]!;
		fbb[i] = fb[i]! * fb[i]!;
		fab[i] = fa[i]! * fb[i]!;
	}
	const mua = convolve(fa, width, height, kernel);
	const mub = convolve(fb, width, height, kernel);
	const saa = convolve(faa, width, height, kernel);
	const sbb = convolve(fbb, width, height, kernel);
	const sab = convolve(fab, width, height, kernel);

	const c1 = (0.01 * 255) ** 2;
	const c2 = (0.03 * 255) ** 2;
	let total = 0;
	for (let i = 0; i < n; i++) {
		const ma = mua[i]!;
		const mb = mub[i]!;
		const va = saa[i]! - ma * ma;
		const vb = sbb[i]! - mb * mb;
		const cab = sab[i]! - ma * mb;
		total += ((2 * ma * mb + c1) * (2 * cab + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
	}
	return total / n;
}
