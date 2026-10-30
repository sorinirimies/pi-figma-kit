/** Read/explore tools: structure, design context, code generation, search. */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { type Framework, generate } from "../design/codegen.ts";
import { generateCompose } from "../design/compose.ts";
import { type DNode, collectAssets, countNodes, outline, simplify } from "../design/simplify.ts";
import { type Ctx, FILE, NODE_IDS, fetchNodes, nodeUrl, target, text, tokenSource } from "./util.ts";

const DEPTH = Type.Optional(Type.Number({ description: "default 6", minimum: 0, maximum: 30 }));
const MAX_NODES = Type.Optional(Type.Number({ description: "per root, default 400", minimum: 1, maximum: 5000 }));

function needNode(ids: string[]) {
	if (!ids.length) throw new Error("No node id. Pass node_ids, or a URL containing ?node-id=. Use figma_get_file_structure to discover ids.");
}

function assetHints(key: string, roots: DNode[]): string {
	const lines: string[] = [];
	for (const r of roots) {
		const { icons, images } = collectAssets(r);
		if (icons.length) lines.push(`SVG icons (export with figma_download_assets format=svg): ${icons.map((i) => `${i.name}#${i.id}`).join(", ")}`);
		if (images.length) lines.push(`Image fills (export with figma_download_assets format=png, or figma_download_image_fills): ${images.map((i) => `${i.name}#${i.id}[${i.imageRef}]`).join(", ")}`);
	}
	return lines.length ? `\n\n## Assets\n${lines.join("\n")}` : "";
}

export function readTools({ client }: Ctx) {
	const structure = defineTool({
		name: "figma_get_file_structure",
		label: "Figma: file structure",
		description: "Pages and top-level frames of a file (ids, types, sizes). Start here to find node ids.",
		promptSnippet: "Explore a Figma file: pages and top-level frames with node ids",
		parameters: Type.Object({
			file: FILE,
			depth: Type.Optional(Type.Number({ description: "2 = pages + frames (default), 3 adds children", minimum: 1, maximum: 4 })),
		}),
		async execute(_id, p) {
			const { ref } = target(p.file);
			const f = await client.get(`/v1/files/${ref.key}`, { depth: p.depth ?? 2 });
			const lines = [
				`# ${f.name}`,
				`key: ${ref.key} · version: ${f.version} · last modified: ${f.lastModified}`,
				`components: ${Object.keys(f.components ?? {}).length} · component sets: ${Object.keys(f.componentSets ?? {}).length} · styles: ${Object.keys(f.styles ?? {}).length}`,
				"",
			];
			const walk = (n: any, ind: number) => {
				const bb = n.absoluteBoundingBox;
				lines.push(`${"  ".repeat(ind)}${n.type} "${n.name}" #${n.id}${bb ? ` ${Math.round(bb.width)}x${Math.round(bb.height)}` : ""}${ind > 0 ? ` ${nodeUrl(ref.key, n.id)}` : ""}`);
				for (const c of n.children ?? []) walk(c, ind + 1);
			};
			for (const page of f.document.children ?? []) walk(page, 0);
			return text(lines.join("\n"), { key: ref.key, name: f.name });
		},
	});

	const context = defineTool({
		name: "figma_get_design_context",
		label: "Figma: design context",
		description:
			"Compact design tree of nodes for implementing or reviewing UI: auto-layout, CSS styles (fills, gradients, borders, radii, shadows, blurs, typography incl. mixed text runs), text, components, style names, SVG icons and image fills.",
		promptSnippet: "Get a compact, CSS-annotated design tree for Figma nodes (to implement UI)",
		parameters: Type.Object({ file: FILE, node_ids: NODE_IDS, depth: DEPTH, max_nodes: MAX_NODES, format: Type.Optional(StringEnum(["outline", "json"], { description: "default outline" })) }),
		async execute(_id, p) {
			const { ref, ids } = target(p.file, p.node_ids);
			needNode(ids);
			const r = await fetchNodes(client, ref.key, ids);
			const tok = await tokenSource(client, ref.key, r.docs);
			const trees = r.docs.map((d) => simplify(d, { depth: p.depth, maxNodes: p.max_nodes, components: r.components, styles: r.styles, varNames: tok.names }));
			const body = p.format === "json" ? JSON.stringify(trees) : trees.map((t) => outline(t)).join("\n\n");
			const missing = r.missing.length ? `\nNot found: ${r.missing.join(", ")}` : "";
			return text(`${body}${assetHints(ref.key, trees)}${missing}${tok.note}`, { nodes: trees.reduce((a, t) => a + countNodes(t), 0) });
		},
	});

	const code = defineTool({
		name: "figma_generate_code",
		label: "Figma: generate code",
		description:
			"Code scaffold for a node: HTML+CSS, React, Tailwind or Jetpack Compose. Adapt it to the project's components afterwards; icons are referenced as files to export with figma_download_assets.",
		promptSnippet: "Generate HTML/React/Tailwind scaffold code from a Figma node",
		parameters: Type.Object({
			file: FILE,
			node_id: Type.Optional(Type.String({ description: "default: URL node-id" })),
			framework: Type.Optional(StringEnum(["html", "react", "tailwind", "compose"], { description: "default react" })),
			depth: DEPTH,
			max_nodes: MAX_NODES,
			assets_dir: Type.Optional(Type.String({ description: "asset path prefix, default ./assets" })),
			component_name: Type.Optional(Type.String()),
		}),
		async execute(_id, p) {
			const { ref, ids } = target(p.file, p.node_id ? [p.node_id] : undefined);
			needNode(ids);
			const r = await fetchNodes(client, ref.key, [ids[0]!]);
			if (!r.docs[0]) throw new Error(`Node ${ids[0]} not found`);
			const tok = await tokenSource(client, ref.key, [r.docs[0]]);
			const tree = simplify(r.docs[0], { depth: p.depth, maxNodes: p.max_nodes, components: r.components, styles: r.styles, varNames: tok.names });
			const fw = p.framework ?? "react";
			if (fw === "compose") {
				const k = generateCompose(tree, p.component_name);
				return text(`## compose (${countNodes(tree)} nodes)\n\`\`\`kotlin\n${k.imports.map((i) => `import ${i}`).join("\n")}\n\n${k.code}\`\`\`${assetHints(ref.key, [tree])}\n\nNote: R.drawable.* names match the exported asset file names (svg → vector drawable via Android Studio import).${tok.note}`, { framework: fw });
			}
			const out = generate(tree, { framework: fw as Framework, assetsDir: p.assets_dir, componentName: p.component_name });
			const parts = [`## ${fw} (${countNodes(tree)} nodes)`, "```" + (fw === "html" ? "html" : "tsx"), out.code, "```"];
			if (out.css) parts.push("## CSS", "```css", out.css, "```");
			return text(parts.join("\n") + assetHints(ref.key, [tree]) + "\n\nNote: `url(./assets/<ref>.png)` backgrounds correspond to image fills; svg <img> srcs to icon exports." + (`${out.code}${out.css ?? ""}`.includes("var(--") ? " var(--token, value) = a Figma variable or style; define them with figma_export_tokens." : "") + tok.note, { framework: fw });
		},
	});

	const search = defineTool({
		name: "figma_search_nodes",
		label: "Figma: search nodes",
		description: "Find nodes by name or text content (case-insensitive substring or /regex/), optionally by type. Returns ids, page and URL.",
		parameters: Type.Object({
			file: FILE,
			query: Type.String(),
			types: Type.Optional(Type.Array(Type.String(), { description: "e.g. FRAME, INSTANCE, TEXT" })),
			limit: Type.Optional(Type.Number({ default: 50 })),
		}),
		async execute(_id, p) {
			const { ref } = target(p.file);
			const f = await client.get(`/v1/files/${ref.key}`);
			const m = /^\/(.+)\/$/.exec(p.query);
			const re = m ? new RegExp(m[1]!, "i") : undefined;
			const q = p.query.toLowerCase();
			const hit = (s: string | undefined) => !!s && (re ? re.test(s) : s.toLowerCase().includes(q));
			const types = new Set((p.types ?? []).map((t) => t.toUpperCase()));
			const limit = p.limit ?? 50;
			const out: string[] = [];
			const walk = (n: any, path: string) => {
				if (out.length >= limit) return;
				if (n.type !== "DOCUMENT" && (!types.size || types.has(n.type)) && (hit(n.name) || (n.type === "TEXT" && hit(n.characters)))) {
					out.push(`${n.type} "${n.name}" #${n.id} in ${path}${n.type === "TEXT" ? ` text=${JSON.stringify(String(n.characters).slice(0, 80))}` : ""} ${nodeUrl(ref.key, n.id)}`);
				}
				for (const c of n.children ?? []) walk(c, n.type === "CANVAS" ? n.name : path);
			};
			walk(f.document, "");
			return text(out.length ? out.join("\n") : "No matches.", { count: out.length });
		},
	});

	const raw = defineTool({
		name: "figma_get_node_raw",
		label: "Figma: raw node JSON",
		description: "Raw REST JSON of nodes, for what design context omits (constraints, interactions, boundVariables).",
		parameters: Type.Object({ file: FILE, node_ids: NODE_IDS, depth: DEPTH }),
		async execute(_id, p) {
			const { ref, ids } = target(p.file, p.node_ids);
			needNode(ids);
			const r = await client.get(`/v1/files/${ref.key}/nodes`, { ids: ids.join(","), depth: p.depth ?? 2 });
			return text(JSON.stringify(r.nodes));
		},
	});

	return [structure, context, code, search, raw];
}
