/** Read/explore tools: structure, design context, code generation, search. */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { type Framework, generate } from "../design/codegen.ts";
import { type DNode, collectAssets, countNodes, outline, simplify } from "../design/simplify.ts";
import { type Ctx, FILE, NODE_IDS, fetchNodes, nodeUrl, target, text } from "./util.ts";

const DEPTH = Type.Optional(Type.Number({ description: "Max tree depth below each node (default 6)", minimum: 0, maximum: 30 }));
const MAX_NODES = Type.Optional(Type.Number({ description: "Max nodes per root (default 400)", minimum: 1, maximum: 5000 }));

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
		description: "List a Figma file's pages and their top-level frames (ids, types, sizes). Start here to explore a file and find node ids.",
		promptSnippet: "Explore a Figma file: pages and top-level frames with node ids",
		parameters: Type.Object({
			file: FILE,
			depth: Type.Optional(Type.Number({ description: "2 = pages + top-level frames (default); 3 adds their children", minimum: 1, maximum: 4 })),
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
			"Fetch one or more nodes and return a compact design tree: layout (flex/auto-layout, gaps, padding), CSS-ready styles (fills, gradients, borders, radii, shadows, blurs, typography incl. mixed text runs), text content, component names, applied style names, and which nodes are SVG icons / image fills. Use this to implement or review a design.",
		promptSnippet: "Get a compact, CSS-annotated design tree for Figma nodes (to implement UI)",
		promptGuidelines: [
			"For Figma-to-code: figma_get_design_context (or figma_generate_code for a scaffold), then figma_get_screenshot to compare visually, and figma_download_assets for icons/images.",
		],
		parameters: Type.Object({ file: FILE, node_ids: NODE_IDS, depth: DEPTH, max_nodes: MAX_NODES, format: Type.Optional(Type.Union([Type.Literal("outline"), Type.Literal("json")], { description: "outline (default, compact) or json" })) }),
		async execute(_id, p) {
			const { ref, ids } = target(p.file, p.node_ids);
			needNode(ids);
			const r = await fetchNodes(client, ref.key, ids);
			const trees = r.docs.map((d) => simplify(d, { depth: p.depth, maxNodes: p.max_nodes, components: r.components, styles: r.styles }));
			const body = p.format === "json" ? JSON.stringify(trees) : trees.map((t) => outline(t)).join("\n\n");
			const missing = r.missing.length ? `\nNot found: ${r.missing.join(", ")}` : "";
			return text(`${body}${assetHints(ref.key, trees)}${missing}`, { nodes: trees.reduce((a, t) => a + countNodes(t), 0) });
		},
	});

	const code = defineTool({
		name: "figma_generate_code",
		label: "Figma: generate code",
		description:
			"Generate a code scaffold for a Figma node: HTML+CSS, React (JSX + CSS), or Tailwind (arbitrary-value classes). Positions, flex layout, colors, typography, borders, shadows are translated; adapt it to the project's design system/components afterwards. Icons become <img> refs to be exported via figma_download_assets.",
		promptSnippet: "Generate HTML/React/Tailwind scaffold code from a Figma node",
		parameters: Type.Object({
			file: FILE,
			node_id: Type.Optional(Type.String({ description: "Node id (defaults to the URL's node-id)" })),
			framework: Type.Optional(Type.Union([Type.Literal("html"), Type.Literal("react"), Type.Literal("tailwind")], { description: "default: react" })),
			depth: DEPTH,
			max_nodes: MAX_NODES,
			assets_dir: Type.Optional(Type.String({ description: "Path prefix for asset references (default ./assets)" })),
			component_name: Type.Optional(Type.String()),
		}),
		async execute(_id, p) {
			const { ref, ids } = target(p.file, p.node_id ? [p.node_id] : undefined);
			needNode(ids);
			const r = await fetchNodes(client, ref.key, [ids[0]!]);
			if (!r.docs[0]) throw new Error(`Node ${ids[0]} not found`);
			const tree = simplify(r.docs[0], { depth: p.depth, maxNodes: p.max_nodes, components: r.components, styles: r.styles });
			const fw = (p.framework ?? "react") as Framework;
			const out = generate(tree, { framework: fw, assetsDir: p.assets_dir, componentName: p.component_name });
			const parts = [`## ${fw} (${countNodes(tree)} nodes)`, "```" + (fw === "html" ? "html" : "tsx"), out.code, "```"];
			if (out.css) parts.push("## CSS", "```css", out.css, "```");
			return text(parts.join("\n") + assetHints(ref.key, [tree]) + "\n\nNote: `url(./assets/<ref>.png)` backgrounds correspond to image fills; svg <img> srcs to icon exports.", { framework: fw });
		},
	});

	const search = defineTool({
		name: "figma_search_nodes",
		label: "Figma: search nodes",
		description: "Search a file for nodes by name or text content (case-insensitive substring or /regex/), optionally filtered by node type. Returns ids, type, page path, and URL.",
		parameters: Type.Object({
			file: FILE,
			query: Type.String({ description: 'Substring, or "/regex/"' }),
			types: Type.Optional(Type.Array(Type.String(), { description: "e.g. FRAME, COMPONENT, INSTANCE, TEXT" })),
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
		description: "Escape hatch: the raw Figma REST JSON for nodes (use when design context is missing something, e.g. constraints, prototype interactions, boundVariables).",
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
