/** Asset export: default names match codegen, collisions, render batching, parallel downloads, fill extensions. */
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FigmaClient } from "../extensions/core/api.ts";
import { generate } from "../extensions/design/codegen.ts";
import { generateCompose } from "../extensions/design/compose.ts";
import { simplify } from "../extensions/design/simplify.ts";
import { assetTools } from "../extensions/tools/assets.ts";
import { imageExt, mapLimit } from "../extensions/tools/util.ts";

const KEY = "AbC123xyz90";
const NAMES: Record<string, string> = { "1:5": "Icon / Star", "1:6": "Icon / Star", "1:7": "Logo" };

function setup(opts: { fillMime?: string } = {}) {
	const renders: string[][] = [];
	let active = 0;
	let peak = 0;
	const fetch = async (u: string) => {
		const url = new URL(u);
		if (url.hostname === "img.test") {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 2));
			active--;
			return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": url.pathname.startsWith("/fill") ? opts.fillMime ?? "image/png" : "image/svg+xml" } });
		}
		const ids = url.searchParams.get("ids")?.split(",") ?? [];
		if (url.pathname.startsWith("/v1/images/")) {
			renders.push(ids);
			return Response.json({ images: Object.fromEntries(ids.map((id) => [id, id === "9:9" ? null : `https://img.test/${id}`])) });
		}
		if (url.pathname.endsWith("/nodes")) return Response.json({ nodes: Object.fromEntries(ids.map((id) => [id, NAMES[id] ? { document: { id, name: NAMES[id] } } : null])) });
		if (url.pathname.endsWith("/images")) return Response.json({ meta: { images: { abc: "https://img.test/fill-abc" } } });
		return new Response("{}", { status: 404 });
	};
	const client = new FigmaClient({ getToken: () => "t", fetch });
	const [screenshot, assets, fills] = assetTools({ client, mcp: {} as any });
	const dir = mkdtempSync(join(tmpdir(), "figma-assets-"));
	const run = (t: any, p: any) => t.execute("id", p, undefined, undefined, { cwd: dir });
	return { screenshot, assets, fills, dir, run, renders, peak: () => peak };
}

test("default file names are the node-name slugs codegen references; repeats get -2", async () => {
	const s = setup();
	const r = await s.run(s.assets, { file: KEY, assets: [{ node_id: "1:5" }, { node_id: "1-6" }, { node_id: "1:7", filename: "brand" }, { node_id: "1:8" }] });
	const out = r.content[0].text as string;
	expect(readdirSync(join(s.dir, "assets")).sort()).toEqual(["1_8.svg", "brand.svg", "icon-star-2.svg", "icon-star.svg"]);
	expect(out.split("\n").map((l: string) => l.split(" → ")[0])).toEqual(["#1:5", "#1:6", "#1:7", "#1:8"]); // request order kept
	// The name figma_generate_code uses for the same node:
	const tree = simplify({ id: "1:1", name: "Root", type: "FRAME", children: [{ id: "1:4", name: "T", type: "TEXT", characters: "Hi" }, { id: "1:5", name: "Icon / Star", type: "VECTOR" }] } as any);
	expect(generate(tree, { framework: "html" }).code).toContain("./assets/icon-star.svg");
	expect(generateCompose(tree).code).toContain("R.drawable.icon_star");
});

test("no name lookup when every asset has a filename", async () => {
	const s = setup();
	await s.run(s.assets, { file: KEY, assets: [{ node_id: "1:5", filename: "a" }] });
	expect(existsSync(join(s.dir, "assets", "a.svg"))).toBe(true);
});

test("renders are batched and downloads run in parallel, capped", async () => {
	const s = setup();
	const ids = Array.from({ length: 120 }, (_, i) => `2:${i}`);
	const r = await s.run(s.screenshot, { file: KEY, node_ids: [...ids, "9:9"], dir: "shots" });
	expect(s.renders.map((b) => b.length)).toEqual([50, 50, 21]);
	expect(s.peak()).toBeGreaterThan(1);
	expect(s.peak()).toBeLessThanOrEqual(6);
	expect(r.content.filter((c: any) => c.type === "image")).toHaveLength(4);
	expect(r.content[0].text.split("\n")).toHaveLength(121);
	expect(r.content[0].text).toContain("#9:9: not renderable");
	expect(readdirSync(join(s.dir, "shots"))).toHaveLength(120);
});

test("image fills keep their real type", async () => {
	const jpg = setup({ fillMime: "image/jpeg" });
	const t = (await jpg.run(jpg.fills, { file: KEY, refs: ["abc"] })).content[0].text;
	expect(t).toContain("abc.jpg (jpg: update generated url(…/abc.png) references)");
	const png = setup();
	expect((await png.run(png.fills, { file: KEY, refs: ["abc"] })).content[0].text).toMatch(/abc\.png$/);
});

test("helpers", async () => {
	expect(imageExt("image/jpeg; charset=x")).toBe("jpg");
	expect(imageExt("IMAGE/WEBP")).toBe("webp");
	expect(imageExt("application/octet-stream")).toBe("png");
	expect(await mapLimit([], 3, async (x) => x)).toEqual([]);
	expect(await mapLimit([3, 1, 2], 2, async (x) => (await new Promise((r) => setTimeout(r, x)), x * 10))).toEqual([30, 10, 20]);
});
