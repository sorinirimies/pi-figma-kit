/** Perceptual pixel diff of a design render against an implementation screenshot (pixelmatch-style YIQ delta). */
import type { Image } from "./png.ts";

export interface DiffResult {
	/** Compared area (the overlap of both images). */
	width: number;
	height: number;
	mismatched: number;
	/** 0..100 over the compared area. */
	percent: number;
	/** Box around all mismatched pixels, if any. */
	bounds?: { x: number; y: number; width: number; height: number };
	/** 3x3 grid cells with more than 1% mismatch, worst first. */
	regions: { name: string; percent: number }[];
	/** Faded design with mismatches in red. */
	image: Image;
}

const MAX_DELTA = 35215;

/** Composite on white, so transparent areas compare like they look on a white page. */
function rgb(d: Uint8Array, i: number): [number, number, number] {
	const a = d[i + 3]! / 255;
	return [255 + (d[i]! - 255) * a, 255 + (d[i + 1]! - 255) * a, 255 + (d[i + 2]! - 255) * a];
}

function delta(a: [number, number, number], b: [number, number, number]): number {
	const y = (c: number[]) => c[0]! * 0.29889531 + c[1]! * 0.58662247 + c[2]! * 0.11448223;
	const i = (c: number[]) => c[0]! * 0.59597799 - c[1]! * 0.2741761 - c[2]! * 0.32180189;
	const q = (c: number[]) => c[0]! * 0.21147017 - c[1]! * 0.52261711 + c[2]! * 0.31114694;
	const dy = y(a) - y(b), di = i(a) - i(b), dq = q(a) - q(b);
	return 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
}

const ROWS = ["top", "middle", "bottom"];
const COLS = ["left", "center", "right"];

/** `threshold` 0..1: how different a pixel's color must be to count (0.1 ignores slight anti-aliasing shifts). */
export function diffImages(design: Image, impl: Image, threshold = 0.1): DiffResult {
	const width = Math.min(design.width, impl.width);
	const height = Math.min(design.height, impl.height);
	const out = new Uint8Array(width * height * 4);
	const limit = MAX_DELTA * threshold * threshold;
	const cells = new Array(9).fill(0);
	const cellArea = new Array(9).fill(0);
	let mismatched = 0;
	let x0 = width, y0 = height, x1 = -1, y1 = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const a = rgb(design.data, (y * design.width + x) * 4);
			const b = rgb(impl.data, (y * impl.width + x) * 4);
			const o = (y * width + x) * 4;
			const cell = Math.min(2, Math.floor((y * 3) / height)) * 3 + Math.min(2, Math.floor((x * 3) / width));
			cellArea[cell]++;
			if (delta(a, b) > limit) {
				mismatched++;
				cells[cell]++;
				x0 = Math.min(x0, x), y0 = Math.min(y0, y), x1 = Math.max(x1, x), y1 = Math.max(y1, y);
				out.set([255, 0, 0, 255], o);
			} else {
				const l = 255 - (255 - (a[0] * 0.299 + a[1] * 0.587 + a[2] * 0.114)) * 0.15;
				out.set([l, l, l, 255], o);
			}
		}
	}
	const area = width * height;
	const pct = (n: number, d: number) => (d ? Math.round((n / d) * 10000) / 100 : 0);
	return {
		width,
		height,
		mismatched,
		percent: pct(mismatched, area),
		bounds: x1 >= 0 ? { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } : undefined,
		regions: cells
			.map((n, i) => ({ name: `${ROWS[Math.floor(i / 3)]}-${COLS[i % 3]}`, percent: pct(n, cellArea[i]) }))
			.filter((r) => r.percent > 1)
			.sort((a, b) => b.percent - a.percent),
		image: { width, height, data: out },
	};
}
