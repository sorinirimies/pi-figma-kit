/** Rendering & export: screenshots, icon/image downloads. */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { type Ctx, FILE, NODE_IDS, resolveDir, safeName, saveBytes, target, text } from "./util.ts";

const FORMAT = Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpg"), Type.Literal("svg"), Type.Literal("pdf")], { description: "default png" }));
const SCALE = Type.Optional(Type.Number({ description: "1-4 (png/jpg only), default 2", minimum: 0.01, maximum: 4 }));

async function render(client: Ctx["client"], key: string, ids: string[], format: string, scale: number | undefined, svgOpts = false) {
	const r = await client.get(`/v1/images/${key}`, {
		ids: ids.join(","),
		format,
		scale: format === "svg" || format === "pdf" ? undefined : scale ?? 2,
		svg_outline_text: svgOpts ? true : undefined,
		svg_include_id: undefined,
	});
	if (r.err) throw new Error(`Figma render error: ${r.err}`);
	return (r.images ?? {}) as Record<string, string | null>;
}

export function assetTools({ client }: Ctx) {
	const screenshot = defineTool({
		name: "figma_get_screenshot",
		label: "Figma: screenshot",
		description: "Render Figma nodes to an image. PNG/JPG are shown to you inline (up to 4) and saved to disk; SVG/PDF are saved only. Use it to see the design and to compare against your implementation.",
		promptSnippet: "Render Figma nodes as images you can look at",
		parameters: Type.Object({ file: FILE, node_ids: NODE_IDS, format: FORMAT, scale: SCALE, dir: Type.Optional(Type.String({ description: "Where to save (default: temp dir)" })) }),
		async execute(_id, p, _s, _u, ctx) {
			const { ref, ids } = target(p.file, p.node_ids);
			if (!ids.length) throw new Error("No node id. Pass node_ids or a URL with ?node-id=.");
			const format = p.format ?? "png";
			const urls = await render(client, ref.key, ids, format, p.scale);
			const dir = resolveDir(ctx.cwd, p.dir, join(tmpdir(), "pi-figma", ref.key));
			const content: any[] = [];
			const lines: string[] = [];
			let shown = 0;
			for (const id of ids) {
				const url = urls[id];
				if (!url) {
					lines.push(`#${id}: not renderable (missing, hidden or empty)`);
					continue;
				}
				const { bytes, mime } = await client.download(url);
				const path = await saveBytes(dir, `${safeName(id)}.${format}`, bytes);
				lines.push(`#${id} → ${path}`);
				if ((format === "png" || format === "jpg") && shown < 4) {
					content.push({ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: format === "jpg" ? "image/jpeg" : mime.startsWith("image/") ? mime : "image/png" });
					shown++;
				}
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }, ...content], details: { dir } };
		},
	});

	const assets = defineTool({
		name: "figma_download_assets",
		label: "Figma: download assets",
		description: "Export nodes (icons, illustrations, image-filled frames) into the project as files. Use svg for icons, png/jpg (scale 2-3) for raster artwork.",
		parameters: Type.Object({
			file: FILE,
			assets: Type.Array(Type.Object({ node_id: Type.String(), filename: Type.Optional(Type.String({ description: "Without extension" })) }), { minItems: 1 }),
			format: FORMAT,
			scale: SCALE,
			dir: Type.Optional(Type.String({ description: "Output dir, relative to cwd (default ./assets)" })),
		}),
		async execute(_id, p, _s, _u, ctx) {
			const { ref } = target(p.file);
			const format = p.format ?? "svg";
			const items = p.assets.map((a) => ({ ...a, node_id: target(ref.key, [a.node_id]).ids[0]! }));
			const urls = await render(client, ref.key, items.map((a) => a.node_id), format, p.scale);
			const dir = resolveDir(ctx.cwd, p.dir, "assets");
			const lines: string[] = [];
			for (const a of items) {
				const url = urls[a.node_id];
				if (!url) {
					lines.push(`#${a.node_id}: not renderable`);
					continue;
				}
				const { bytes } = await client.download(url);
				lines.push(`#${a.node_id} → ${await saveBytes(dir, `${safeName(a.filename ?? a.node_id)}.${format}`, bytes)}`);
			}
			return text(lines.join("\n"), { dir });
		},
	});

	const fills = defineTool({
		name: "figma_download_image_fills",
		label: "Figma: download image fills",
		description: "Download original bitmap images used as fills in a file (by imageRef hash from the design context). Without refs, lists all available refs.",
		parameters: Type.Object({ file: FILE, refs: Type.Optional(Type.Array(Type.String())), dir: Type.Optional(Type.String()) }),
		async execute(_id, p, _s, _u, ctx) {
			const { ref } = target(p.file);
			const r = await client.get(`/v1/files/${ref.key}/images`);
			const map: Record<string, string> = r.meta?.images ?? {};
			if (!p.refs?.length) return text(`${Object.keys(map).length} image fills:\n${Object.keys(map).join("\n")}`);
			const dir = resolveDir(ctx.cwd, p.dir, "assets");
			const lines: string[] = [];
			for (const h of p.refs) {
				const url = map[h];
				if (!url) {
					lines.push(`${h}: not found`);
					continue;
				}
				const { bytes } = await client.download(url);
				lines.push(`${h} → ${await saveBytes(dir, `${safeName(h)}.png`, bytes)}`);
			}
			return text(lines.join("\n"), { dir });
		},
	});

	return [screenshot, assets, fills];
}
