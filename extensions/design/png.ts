/**
 * Minimal PNG codec (no dependencies): decodes non-interlaced PNGs (gray, RGB, palette, gray+alpha, RGBA;
 * 1-16 bit) to 8-bit RGBA and encodes RGBA. Enough for Figma renders and browser/device screenshots.
 */
import { deflateSync, inflateSync } from "node:zlib";

export interface Image {
	width: number;
	height: number;
	/** RGBA, 4 bytes per pixel, row-major. */
	data: Uint8Array;
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** 64 MP: well above any screen (8K = 33 MP), and bounds memory for corrupt or hostile headers. */
export const MAX_PIXELS = 64_000_000;

export function isPng(b: Uint8Array): boolean {
	return b.length > 8 && SIG.every((v, i) => b[i] === v);
}

export function decodePng(buf: Uint8Array): Image {
	if (!isPng(buf)) throw new Error("Not a PNG file.");
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
	let palette: Uint8Array | undefined;
	let trns: Uint8Array | undefined;
	const idat: Uint8Array[] = [];
	for (let o = 8; o + 8 <= buf.length; ) {
		const len = view.getUint32(o);
		const kind = String.fromCharCode(...buf.subarray(o + 4, o + 8));
		const data = buf.subarray(o + 8, o + 8 + len);
		if (kind === "IHDR") {
			width = view.getUint32(o + 8);
			height = view.getUint32(o + 12);
			depth = data[8]!;
			type = data[9]!;
			interlace = data[12]!;
		} else if (kind === "PLTE") palette = data;
		else if (kind === "tRNS") trns = data;
		else if (kind === "IDAT") idat.push(data);
		else if (kind === "IEND") break;
		o += 12 + len;
	}
	const ch = CHANNELS[type];
	if (!width || !height || !ch || ![1, 2, 4, 8, 16].includes(depth)) throw new Error("Unsupported or corrupt PNG.");
	if (interlace) throw new Error("Interlaced PNGs are not supported; save the screenshot without interlacing.");
	if (type === 3 && !palette) throw new Error("Palette PNG without a palette.");

	if (width * height > MAX_PIXELS) throw new Error(`PNG too large (${width}x${height}); max ${MAX_PIXELS / 1e6} megapixels.`);
	const bpp = Math.max(1, (ch * depth) >> 3);
	const stride = Math.ceil((width * ch * depth) / 8);
	// Never inflate more than the header says the image needs (zip-bomb guard).
	let raw: Buffer;
	try {
		raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
	} catch (e) {
		throw new Error(`Corrupt PNG data (${(e as Error).message}).`);
	}
	if (raw.length < (stride + 1) * height) throw new Error("Truncated PNG data.");
	const px = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const f = raw[y * (stride + 1)]!;
		const src = y * (stride + 1) + 1;
		const row = y * stride;
		const prev = row - stride;
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? px[row + x - bpp]! : 0;
			const b = y ? px[prev + x]! : 0;
			const c = x >= bpp && y ? px[prev + x - bpp]! : 0;
			const v = raw[src + x]!;
			let out: number;
			if (f === 0) out = v;
			else if (f === 1) out = v + a;
			else if (f === 2) out = v + b;
			else if (f === 3) out = v + ((a + b) >> 1);
			else if (f === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
			} else throw new Error(`Bad PNG filter ${f}.`);
			px[row + x] = out & 255;
		}
	}

	// Sample i of row y as an 8-bit value (palette index stays an index).
	const sample = (row: number, i: number): number => {
		if (depth === 8) return px[row + i]!;
		if (depth === 16) return px[row + i * 2]!;
		const perByte = 8 / depth;
		const byte = px[row + Math.floor(i / perByte)]!;
		const v = (byte >> (8 - depth * ((i % perByte) + 1))) & ((1 << depth) - 1);
		return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
	};
	const trnsGray = trns && type === 0 ? (trns[0]! << 8) | trns[1]! : -1;
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const row = y * stride;
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			const s = x * ch;
			if (type === 3) {
				const i = sample(row, x);
				out[o] = palette![i * 3] ?? 0;
				out[o + 1] = palette![i * 3 + 1] ?? 0;
				out[o + 2] = palette![i * 3 + 2] ?? 0;
				out[o + 3] = trns?.[i] ?? 255;
			} else if (type === 0 || type === 4) {
				const g = sample(row, s);
				out[o] = out[o + 1] = out[o + 2] = g;
				out[o + 3] = type === 4 ? sample(row, s + 1) : depth <= 8 && trnsGray >= 0 && g === Math.round((trnsGray * 255) / ((1 << depth) - 1)) ? 0 : 255;
			} else {
				out[o] = sample(row, s);
				out[o + 1] = sample(row, s + 1);
				out[o + 2] = sample(row, s + 2);
				out[o + 3] = type === 6 ? sample(row, s + 3) : 255;
			}
		}
	}
	return { width, height, data: out };
}

const CRC = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC[(c ^ b) & 255]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(kind: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const v = new DataView(out.buffer);
	v.setUint32(0, data.length);
	out.set([...kind].map((c) => c.charCodeAt(0)), 4);
	out.set(data, 8);
	v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

export function encodePng(img: Image): Uint8Array {
	const ihdr = new Uint8Array(13);
	const v = new DataView(ihdr.buffer);
	v.setUint32(0, img.width);
	v.setUint32(4, img.height);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const stride = img.width * 4;
	const raw = new Uint8Array((stride + 1) * img.height);
	for (let y = 0; y < img.height; y++) raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	return Buffer.concat([Buffer.from(SIG), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}
