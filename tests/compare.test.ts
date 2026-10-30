/** PNG codec, image diff and the figma_compare tool. */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { FigmaClient } from "../extensions/core/api.ts";
import { diffImages } from "../extensions/design/diff.ts";
import { type Image, decodePng, encodePng, isPng } from "../extensions/design/png.ts";
import { assetTools } from "../extensions/tools/assets.ts";

const fixture = (n: string) => new Uint8Array(readFileSync(join(import.meta.dir, "png", n)));
const expected: Record<string, number[][]> = JSON.parse(readFileSync(join(import.meta.dir, "png", "expected.json"), "utf8"));

test("decodes Pillow-written PNGs of every color type and depth", () => {
	for (const [name, pixels] of Object.entries(expected)) {
		const img = decodePng(fixture(name));
		expect([img.width, img.height]).toEqual([7, 5]);
		expect([...img.data]).toEqual(pixels.flat());
	}
	const rgb16 = decodePng(fixture("rgb16.png"));
	expect([...rgb16.data.subarray(4, 8)]).toEqual([3, 0, 255, 255]); // 1000 >> 8, high byte
});

/** Build a PNG with the given header and raw scanlines, applying `filter` to every row. */
function build(w: number, h: number, depth: number, type: number, rows: number[][], filter: number, extra: [string, number[]][] = []): Uint8Array {
	const bpp = Math.max(1, ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as any)[type] * depth >> 3);
	const out: number[] = [];
	rows.forEach((row, y) => {
		out.push(filter);
		const prev = rows[y - 1];
		row.forEach((v, x) => {
			const a = x >= bpp ? row[x - bpp]! : 0;
			const b = prev ? prev[x]! : 0;
			const c = x >= bpp && prev ? prev[x - bpp]! : 0;
			const pr = (): number => {
				const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			};
			const pred = [0, a, b, (a + b) >> 1, pr()][filter]!;
			out.push((v - pred) & 255);
		});
	});
	const chunk = (kind: string, data: number[] | Uint8Array) => {
		const d = Uint8Array.from(data);
		const b = new Uint8Array(12 + d.length);
		new DataView(b.buffer).setUint32(0, d.length);
		b.set([...kind].map((ch) => ch.charCodeAt(0)), 4);
		b.set(d, 8);
		return b; // the decoder does not verify CRCs
	};
	const ihdr = new Uint8Array(13);
	new DataView(ihdr.buffer).setUint32(0, w);
	new DataView(ihdr.buffer).setUint32(4, h);
	ihdr.set([depth, type, 0, 0, 0], 8);
	return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", ihdr), ...extra.flatMap(([k, d]) => [...chunk(k, d)]), ...chunk("IDAT", deflateSync(Uint8Array.from(out))), ...chunk("IEND", [])]);
}

test("all five scanline filters", () => {
	const rows = [[10, 20, 30, 255, 40, 50, 60, 128], [200, 100, 50, 255, 1, 2, 3, 4], [9, 99, 199, 0, 250, 251, 252, 253]];
	for (const f of [0, 1, 2, 3, 4]) expect([...decodePng(build(2, 3, 8, 6, rows, f)).data]).toEqual(rows.flat());
});

test("gray tRNS, palette tRNS, low bit depths, errors", () => {
	const g = decodePng(build(2, 1, 8, 0, [[7, 9]], 0, [["tRNS", [0, 7]]]));
	expect([...g.data]).toEqual([7, 7, 7, 0, 9, 9, 9, 255]);
	const pal = decodePng(build(4, 1, 2, 3, [[0b00011011]], 0, [["PLTE", [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]], ["tRNS", [0, 128]]]));
	expect([...pal.data]).toEqual([1, 1, 1, 0, 2, 2, 2, 128, 3, 3, 3, 255, 4, 4, 4, 255]);
	const g4 = decodePng(build(2, 1, 4, 0, [[0xf0]], 0));
	expect([...g4.data]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
	expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(/Not a PNG/);
	expect(() => decodePng(build(1, 1, 3, 2, [[1, 2, 3]], 0))).toThrow(/Unsupported/);
	const huge = build(1, 1, 8, 0, [[5]], 0);
	huge.set([0, 0, 0x27, 0x10, 0, 0, 0x27, 0x10], 16); // 10000 x 10000
	expect(() => decodePng(huge)).toThrow(/too large/);
	const bomb = build(1, 1, 8, 0, [[5]], 0);
	const z = deflateSync(new Uint8Array(1_000_000));
	const at = Buffer.from(bomb).indexOf("IDAT");
	const bombed = Uint8Array.from([...bomb.slice(0, at - 4), ...[24, 16, 8, 0].map((sh) => (z.length >>> sh) & 255), ...Buffer.from("IDAT"), ...z, 0, 0, 0, 0, ...bomb.slice(-12)]);
	expect(() => decodePng(bombed)).toThrow(/Corrupt PNG data/);
	const interlaced = build(1, 1, 8, 0, [[5]], 0);
	interlaced[28] = 1; // IHDR interlace method
	expect(() => decodePng(interlaced)).toThrow(/Interlaced/);
	expect(() => decodePng(build(1, 1, 8, 3, [[0]], 0))).toThrow(/without a palette/);
	expect(() => decodePng(build(2, 1, 8, 6, [[1, 2, 3, 4, 5, 6, 7, 8]], 0).slice(0, -20))).toThrow();
	const bad = build(1, 1, 8, 0, [[5]], 0);
	expect(() => decodePng(build(1, 2, 8, 0, [[5]], 0))).toThrow(/Truncated/);
	expect(decodePng(bad).width).toBe(1);
	const badFilter = build(1, 1, 8, 0, [[5]], 0);
	// patch the filter byte inside IDAT: rebuild with an invalid filter type
	const raw = deflateSync(Uint8Array.from([9, 5]));
	const i = Buffer.from(badFilter).indexOf("IDAT");
	const patched = Uint8Array.from([...badFilter.slice(0, i - 4), 0, 0, 0, raw.length, ...Buffer.from("IDAT"), ...raw, 0, 0, 0, 0, ...badFilter.slice(-12)]);
	expect(() => decodePng(patched)).toThrow(/Bad PNG filter 9/);
});

test("encode round-trips and is readable by other decoders", () => {
	const img: Image = { width: 3, height: 2, data: Uint8Array.from({ length: 24 }, (_, i) => (i * 41) % 256) };
	const png = encodePng(img);
	expect(isPng(png)).toBe(true);
	expect(decodePng(png)).toEqual(img);
	const p = join(mkdtempSync(join(tmpdir(), "png-")), "x.png");
	writeFileSync(p, png);
	const r = Bun.spawnSync(["python3", "-c", `from PIL import Image; im=Image.open(${JSON.stringify(p)}); im.load(); print(im.size, list(im.getdata())[1])`]);
	if (r.exitCode === 0) expect(r.stdout.toString().trim()).toBe(`(3, 2) (${[4, 5, 6, 7].map((k) => (k * 41) % 256).join(", ")})`);
});

const solid = (w: number, h: number, c: number[]): Image => ({ width: w, height: h, data: Uint8Array.from({ length: w * h * 4 }, (_, i) => c[i % 4]!) });

test("diff: identical, threshold, transparency on white, regions and bounds", () => {
	const a = solid(9, 9, [255, 255, 255, 255]);
	expect(diffImages(a, a)).toMatchObject({ percent: 0, mismatched: 0, bounds: undefined, regions: [] });
	expect(diffImages(a, solid(9, 9, [0, 0, 0, 0])).percent).toBe(0); // transparent = white
	expect(diffImages(a, solid(9, 9, [250, 250, 250, 255])).percent).toBe(0); // within tolerance
	expect(diffImages(a, solid(9, 9, [250, 250, 250, 255]), 0).percent).toBe(100);
	const b = solid(9, 9, [255, 255, 255, 255]);
	for (let y = 0; y < 3; y++) for (let x = 6; x < 9; x++) b.data.set([255, 0, 0, 255], (y * 9 + x) * 4);
	const d = diffImages(a, b);
	expect(d).toMatchObject({ width: 9, height: 9, mismatched: 9, percent: 11.11, bounds: { x: 6, y: 0, width: 3, height: 3 }, regions: [{ name: "top-right", percent: 100 }] });
	expect([...d.image.data.subarray((0 * 9 + 6) * 4, (0 * 9 + 6) * 4 + 4)]).toEqual([255, 0, 0, 255]);
	expect(d.image.data[0]).toBe(255); // white stays (faded) white
	const small = diffImages(a, solid(5, 4, [255, 255, 255, 255]));
	expect([small.width, small.height]).toEqual([5, 4]);
	expect(diffImages(solid(0, 0, [0, 0, 0, 0]), a).percent).toBe(0);
});

function compareTool(designPng: Uint8Array, bbWidth = 100) {
	const seen: URL[] = [];
	const fetch = async (u: string) => {
		const url = new URL(u);
		seen.push(url);
		if (url.hostname === "img.test") return new Response(designPng);
		if (url.pathname.endsWith("/nodes")) {
			const id = url.searchParams.get("ids")!;
			return Response.json({ nodes: { [id]: id === "4:4" ? null : { document: { id, absoluteBoundingBox: id === "5:5" ? {} : { x: 0, y: 0, width: bbWidth, height: 10 } } } } });
		}
		if (url.pathname.startsWith("/v1/images/")) return Response.json({ images: { [url.searchParams.get("ids")!]: url.searchParams.get("ids") === "6:6" ? null : "https://img.test/r" } });
		return new Response("{}", { status: 404 });
	};
	const tool = assetTools({ client: new FigmaClient({ getToken: () => "t", fetch }), mcp: {} as any }).find((t) => t.name === "figma_compare")!;
	const dir = mkdtempSync(join(tmpdir(), "cmp-"));
	return { run: (p: any) => tool.execute("id", { file: "https://figma.com/design/AbC123xyz90/x?node-id=1-2", image: "impl.png", ...p }, undefined, undefined, { cwd: dir } as any), dir, seen };
}

test("figma_compare: renders at the screenshot's width and reports the diff", async () => {
	const design = solid(4, 2, [255, 255, 255, 255]);
	const impl = solid(4, 3, [255, 255, 255, 255]);
	impl.data.set([0, 0, 0, 255], 0);
	const t = compareTool(encodePng(design), 2);
	writeFileSync(join(t.dir, "impl.png"), encodePng(impl));
	const r: any = await t.run({});
	const out = r.content[0].text as string;
	expect(t.seen.find((u) => u.pathname.startsWith("/v1/images/"))!.searchParams.get("scale")).toBe("2"); // 4px screenshot / 2px node
	expect(out).toContain("Mismatch: 12.5% (1 of 8 px, threshold 0.1)");
	expect(out).toContain("Design render: 4x2 @2x · implementation: 4x3");
	expect(out).toContain("Size differs by 0x1 px; only the overlap 4x2 was compared.");
	expect(out).toContain("Differences within x=0 y=0 1x1");
	expect(out).toContain("Regions: top-left 50%");
	expect(r.content.filter((c: any) => c.type === "image")).toHaveLength(2);
	expect(decodePng(new Uint8Array(readFileSync(r.details.diffPath))).width).toBe(4);

	const same: any = await t.run({ image: join(t.dir, "impl.png"), threshold: 1 });
	expect(same.content[0].text).toContain("Mismatch: 0%");
	expect(same.content[0].text).not.toContain("Regions");
});

test("figma_compare: errors", async () => {
	const t = compareTool(encodePng(solid(1, 1, [0, 0, 0, 255])));
	writeFileSync(join(t.dir, "impl.png"), encodePng(solid(1, 1, [0, 0, 0, 255])));
	writeFileSync(join(t.dir, "impl.jpg"), "not a png");
	await expect(t.run({ file: "AbC123xyz90" })).rejects.toThrow(/No node id/);
	await expect(t.run({ image: "impl.jpg" })).rejects.toThrow(/is not a PNG/);
	await expect(t.run({ node_id: "4:4" })).rejects.toThrow(/not found or has no size/);
	await expect(t.run({ node_id: "5:5" })).rejects.toThrow(/not found or has no size/);
	await expect(t.run({ node_id: "6:6" })).rejects.toThrow(/not renderable/);
	const r: any = await t.run({});
	expect(r.content[0].text).toContain("@0.01x"); // 1px screenshot of a 100px node: clamped scale
	expect(r.content[0].text).not.toContain("Size differs");
});
