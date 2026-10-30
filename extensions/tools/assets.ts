/** Rendering & export: screenshots, icon/image downloads. */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { slug } from "../design/codegen.ts";
import { type Ctx, FILE, NODE_IDS, chunks, imageExt, mapLimit, resolveDir, safeName, saveBytes, target, text } from "./util.ts";

/** Parallel downloads per call; Figma's image CDN handles this fine, the REST API is not involved. */
const PARALLEL = 6;
/** Ids per render request, keeps the query string well under URL length limits. */
const RENDER_BATCH = 50;

const FORMAT = Type.Optional(StringEnum(["png", "jpg", "svg", "pdf"]));
const SCALE = Type.Optional(Type.Number({ description: "png/jpg, default 2", minimum: 0.01, maximum: 4 }));

async function render(client: Ctx["client"], key: string, ids: string[], format: string, scale: number | undefined, svgOpts = false) {
	const out: Record<string, string | null> = {};
	for (const batch of chunks(ids, RENDER_BATCH)) {
		const r = await client.get(`/v1/images/${key}`, {
			ids: batch.join(","),
			format,
			scale: format === "svg" || format === "pdf" ? undefined : scale ?? 2,
			svg_outline_text: svgOpts ? true : undefined,
			svg_include_id: undefined,
		});
		if (r.err) throw new Error(`Figma render error: ${r.err}`);
		Object.assign(out, r.images ?? {});
	}
	return out;
}

/**
 * Default file names = slug of the node name, the same name figma_generate_code references
 * (`./assets/<slug>.svg`, `R.drawable.<slug_>`). Repeated names get -2, -3 … in request order.
 */
async function defaultNames(client: Ctx["client"], key: string, ids: string[]): Promise<Record<string, string>> {
	if (!ids.length) return {};
	const r = await client.get(`/v1/files/${key}/nodes`, { ids: ids.join(","), depth: 0 });
	const used = new Map<string, number>();
	const out: Record<string, string> = {};
	for (const id of ids) {
		const name = r.nodes?.[id]?.document?.name;
		const base = name ? slug(name) : safeName(id);
		const k = (used.get(base) ?? 0) + 1;
		used.set(base, k);
		out[id] = k > 1 ? `${base}-${k}` : base;
	}
	return out;
}

export function assetTools({ client }: Ctx) {
	const screenshot = defineTool({
		name: "figma_get_screenshot",
		label: "Figma: screenshot",
		description: "Render nodes to images (default png). PNG/JPG are shown to you (up to 4) and saved; SVG/PDF are only saved.",
		promptSnippet: "Render Figma nodes as images you can look at",
		parameters: Type.Object({ file: FILE, node_ids: NODE_IDS, format: FORMAT, scale: SCALE, dir: Type.Optional(Type.String({ description: "default: temp dir" })) }),
		async execute(_id, p, _s, _u, ctx) {
			const { ref, ids } = target(p.file, p.node_ids);
			if (!ids.length) throw new Error("No node id. Pass node_ids or a URL with ?node-id=.");
			const format = p.format ?? "png";
			const urls = await render(client, ref.key, ids, format, p.scale);
			const dir = resolveDir(ctx.cwd, p.dir, join(tmpdir(), "pi-figma", ref.key));
			const saved = await mapLimit(ids, PARALLEL, async (id) => {
				const url = urls[id];
				if (!url) return { id };
				const { bytes, mime } = await client.download(url);
				return { id, bytes, mime, path: await saveBytes(dir, `${safeName(id)}.${format}`, bytes) };
			});
			const content: any[] = [];
			const lines: string[] = [];
			for (const r of saved) {
				if (!r.path) {
					lines.push(`#${r.id}: not renderable (missing, hidden or empty)`);
					continue;
				}
				lines.push(`#${r.id} → ${r.path}`);
				if ((format === "png" || format === "jpg") && content.length < 4)
					content.push({ type: "image", data: Buffer.from(r.bytes!).toString("base64"), mimeType: format === "jpg" ? "image/jpeg" : r.mime!.startsWith("image/") ? r.mime : "image/png" });
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }, ...content], details: { dir } };
		},
	});

	const assets = defineTool({
		name: "figma_download_assets",
		label: "Figma: download assets",
		description: "Export nodes (icons, illustrations, image frames) into the project as files (default svg).",
		parameters: Type.Object({
			file: FILE,
			assets: Type.Array(Type.Object({ node_id: Type.String(), filename: Type.Optional(Type.String({ description: "no extension; default: node name slug" })) }), { minItems: 1 }),
			format: FORMAT,
			scale: SCALE,
			dir: Type.Optional(Type.String({ description: "default ./assets" })),
		}),
		async execute(_id, p, _s, _u, ctx) {
			const { ref } = target(p.file);
			const format = p.format ?? "svg";
			const items = p.assets.map((a) => ({ ...a, node_id: target(ref.key, [a.node_id]).ids[0]! }));
			const urls = await render(client, ref.key, items.map((a) => a.node_id), format, p.scale);
			const dir = resolveDir(ctx.cwd, p.dir, "assets");
			const names = await defaultNames(client, ref.key, items.filter((a) => !a.filename).map((a) => a.node_id));
			const lines = await mapLimit(items, PARALLEL, async (a) => {
				const url = urls[a.node_id];
				if (!url) return `#${a.node_id}: not renderable`;
				const { bytes } = await client.download(url);
				return `#${a.node_id} → ${await saveBytes(dir, `${safeName(a.filename ?? names[a.node_id]!)}.${format}`, bytes)}`;
			});
			return text(lines.join("\n"), { dir });
		},
	});

	const fills = defineTool({
		name: "figma_download_image_fills",
		label: "Figma: download image fills",
		description: "Download original fill bitmaps by imageRef (from design context) to ./assets by default. Without refs, lists them.",
		parameters: Type.Object({ file: FILE, refs: Type.Optional(Type.Array(Type.String())), dir: Type.Optional(Type.String()) }),
		async execute(_id, p, _s, _u, ctx) {
			const { ref } = target(p.file);
			const r = await client.get(`/v1/files/${ref.key}/images`);
			const map: Record<string, string> = r.meta?.images ?? {};
			if (!p.refs?.length) return text(`${Object.keys(map).length} image fills:\n${Object.keys(map).join("\n")}`);
			const dir = resolveDir(ctx.cwd, p.dir, "assets");
			const lines = await mapLimit(p.refs, PARALLEL, async (h) => {
				const url = map[h];
				if (!url) return `${h}: not found`;
				const { bytes, mime } = await client.download(url);
				const ext = imageExt(mime);
				const path = await saveBytes(dir, `${safeName(h)}.${ext}`, bytes);
				return `${h} → ${path}${ext === "png" ? "" : ` (${ext}: update generated url(…/${h}.png) references)`}`;
			});
			return text(lines.join("\n"), { dir });
		},
	});

	return [screenshot, assets, fills];
}
