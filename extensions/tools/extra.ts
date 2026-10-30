/** Everything else the Figma REST API offers that is useful from an agent: meta, tokens export, flows, text, dev resources, comments admin. */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { collectFlows, renderFlows } from "../design/flows.ts";
import { fromStyles, fromVariables, toCss, toJson, toTailwind, type TokenSet } from "../design/tokens.ts";
import { type Ctx, FILE, NODE_IDS, confirmWrite, fetchNodes, nodeUrl, summarizeVariablesBody, target, text } from "./util.ts";

export function extraTools({ client }: Ctx) {
	const meta = defineTool({
		name: "figma_get_file_meta",
		label: "Figma: file metadata",
		description: "Cheap file metadata: name, folder, creator, last edit, editor type, link access.",
		parameters: Type.Object({ file: FILE }),
		async execute(_id, p) {
			const { ref } = target(p.file);
			const r = await client.get(`/v1/files/${ref.key}/meta`);
			const f = r.file ?? r;
			return text(`${f.name}\nfolder: ${f.folder_name ?? "-"} · editor: ${f.editorType ?? "-"} · role: ${f.role ?? "-"}\ncreator: ${f.creator?.handle ?? "-"} · last touched by ${f.last_touched_by?.handle ?? "-"} at ${f.last_touched_at ?? "-"}\nlink access: ${f.link_access ?? "-"}`, f);
		},
	});

	const component = defineTool({
		name: "figma_get_component",
		label: "Figma: component by key",
		description: "Published component (set) by key: name, description, file, node.",
		parameters: Type.Object({ key: Type.String(), kind: Type.Optional(StringEnum(["component", "component_set"])) }),
		async execute(_id, p) {
			const r = await client.get(`/v1/${p.kind === "component_set" ? "component_sets" : "components"}/${p.key}`);
			const m = r.meta ?? r;
			return text(`${m.name} (${m.node_id}) in file ${m.file_key}${m.description ? `\n${m.description}` : ""}\n${m.file_key && m.node_id ? nodeUrl(m.file_key, m.node_id) : ""}`, m);
		},
	});

	const styleByKey = defineTool({
		name: "figma_get_style",
		label: "Figma: style by key",
		description: "Published style by key: name, type, description, file, node.",
		parameters: Type.Object({ key: Type.String() }),
		async execute(_id, p) {
			const r = await client.get(`/v1/styles/${p.key}`);
			const m = r.meta ?? r;
			return text(`${m.style_type} "${m.name}" (${m.node_id}) in file ${m.file_key}${m.description ? `\n${m.description}` : ""}`, m);
		},
	});

	const teamStyles = defineTool({
		name: "figma_get_team_styles",
		label: "Figma: team library styles",
		description: "Published styles of a team library.",
		parameters: Type.Object({ team_id: Type.String(), query: Type.Optional(Type.String()) }),
		async execute(_id, p) {
			const r = await client.get(`/v1/teams/${p.team_id}/styles`, { page_size: 100 });
			const q = p.query?.toLowerCase();
			const lines = (r.meta?.styles ?? []).filter((s: any) => !q || s.name.toLowerCase().includes(q)).map((s: any) => `${s.style_type} "${s.name}" key=${s.key} file=${s.file_key} #${s.node_id}${s.description ? ` — ${s.description}` : ""}`);
			return text(lines.join("\n") || "No styles.");
		},
	});

	const published = defineTool({
		name: "figma_get_published_variables",
		label: "Figma: published variables",
		description: "Variables a library file publishes. Needs file_variables:read (Enterprise).",
		parameters: Type.Object({ file: FILE }),
		async execute(_id, p) {
			const { ref } = target(p.file);
			const r = await client.get(`/v1/files/${ref.key}/variables/published`);
			const { variables = {}, variableCollections = {} } = r.meta ?? {};
			const lines = Object.values<any>(variableCollections).map((c) => `## ${c.name}\n` + Object.values<any>(variables).filter((v) => v.variableCollectionId === c.id).map((v) => `- ${v.name} [${v.resolvedType}]`).join("\n"));
			return text(lines.join("\n\n") || "No published variables.");
		},
	});

	const updateVars = defineTool({
		name: "figma_update_variables",
		label: "Figma: update variables (write)",
		description: "WRITE: POST /v1/files/:key/variables, raw body {variableCollections?, variableModes?, variables?, variableModeValues?}. Needs file_variables:write (Enterprise).",
		parameters: Type.Object({ file: FILE, body: Type.Record(Type.String(), Type.Unknown()) }),
		async execute(_id, p, _s, _u, ctx) {
			const { ref } = target(p.file);
			await confirmWrite(ctx, "Update Figma variables?", `File ${ref.key}: ${summarizeVariablesBody(p.body)}. This changes the design file for everyone.`);
			const r = await client.post(`/v1/files/${ref.key}/variables`, p.body);
			client.clearCache();
			return text(JSON.stringify(r.meta ?? r));
		},
	});

	const tokens = defineTool({
		name: "figma_export_tokens",
		label: "Figma: export design tokens",
		description:
			"Design tokens as CSS vars (:root + [data-mode] per mode, aliases as var()), nested JSON, or a Tailwind theme. From variables, else styles.",
		promptSnippet: "Export Figma variables/styles as CSS vars, JSON or Tailwind theme",
		parameters: Type.Object({
			file: FILE,
			format: Type.Optional(StringEnum(["css", "json", "tailwind"], { description: "default css" })),
			collection: Type.Optional(Type.String({ description: "name substring" })),
			unit: Type.Optional(Type.String({ description: 'for FLOATs, default "px"' })),
			source: Type.Optional(StringEnum(["auto", "variables", "styles"])),
			selector: Type.Optional(Type.String({ description: "base mode, default :root" })),
		}),
		async execute(_id, p) {
			const { ref } = target(p.file);
			let set: TokenSet | undefined;
			let used = "variables";
			if (p.source !== "styles") {
				try {
					const r = await client.get(`/v1/files/${ref.key}/variables/local`);
					set = fromVariables(r.meta, { unit: p.unit, collection: p.collection });
				} catch (e) {
					if (p.source === "variables") throw e;
				}
			}
			if (!set?.tokens.length && p.source !== "variables") {
				const st = (await client.get(`/v1/files/${ref.key}/styles`)).meta?.styles ?? [];
				const nodes = st.length ? await fetchNodes(client, ref.key, st.map((s: any) => s.node_id).slice(0, 200), 0) : undefined;
				set = fromStyles(st, Object.fromEntries((nodes?.docs ?? []).map((d) => [d.id, d])));
				used = "styles";
			}
			if (!set?.tokens.length) return text("No tokens found (no variables or styles).");
			const fmt = p.format ?? "css";
			const out = fmt === "json" ? toJson(set) : fmt === "tailwind" ? toTailwind(set) + "\n" + toCss(set, p.selector) : toCss(set, p.selector);
			return text(`/* ${set.tokens.length} tokens from ${used}; modes: ${set.modes.join(", ")} */\n${out}`, { count: set.tokens.length, source: used });
		},
	});

	const flows = defineTool({
		name: "figma_get_prototype_flows",
		label: "Figma: prototype flows",
		description: "Prototype flows and interactions (trigger → frame / URL / back), for navigation graphs.",
		parameters: Type.Object({ file: FILE, page: Type.Optional(Type.String({ description: "name substring" })) }),
		async execute(_id, p) {
			const { ref } = target(p.file);
			const f = await client.get(`/v1/files/${ref.key}`);
			const doc = p.page ? { ...f.document, children: (f.document.children ?? []).filter((c: any) => c.name.toLowerCase().includes(p.page!.toLowerCase())) } : f.document;
			return text(renderFlows(collectFlows(doc)));
		},
	});

	const texts = defineTool({
		name: "figma_get_text",
		label: "Figma: text content",
		description: "All text in nodes (copy deck, i18n) with ids, font size and layer path.",
		parameters: Type.Object({ file: FILE, node_ids: NODE_IDS, max: Type.Optional(Type.Number({ default: 300 })) }),
		async execute(_id, p) {
			const { ref, ids } = target(p.file, p.node_ids);
			if (!ids.length) throw new Error("No node id. Pass node_ids or a URL with ?node-id=.");
			const r = await fetchNodes(client, ref.key, ids);
			const out: string[] = [];
			const max = p.max ?? 300;
			const walk = (n: any, path: string[]) => {
				if (out.length >= max || n.visible === false) return;
				if (n.type === "TEXT") out.push(`#${n.id} [${path.join(" / ")}] (${n.style?.fontSize ?? "?"}px) ${JSON.stringify(n.characters)}`);
				for (const c of n.children ?? []) walk(c, n.type === "TEXT" ? path : [...path, n.name]);
			};
			for (const d of r.docs) walk(d, []);
			return text(out.join("\n") || "No text.", { count: out.length });
		},
	});

	const devResources = defineTool({
		name: "figma_get_dev_resources",
		label: "Figma: dev resources",
		description: "Dev Mode links (code, docs, tickets) on nodes.",
		parameters: Type.Object({ file: FILE, node_ids: NODE_IDS }),
		async execute(_id, p) {
			const { ref, ids } = target(p.file, p.node_ids);
			const r = await client.get(`/v1/files/${ref.key}/dev_resources`, { node_ids: ids.join(",") || undefined });
			return text((r.dev_resources ?? []).map((d: any) => `#${d.node_id} "${d.name}" ${d.url} (id=${d.id})`).join("\n") || "No dev resources.");
		},
	});

	const addDevResource = defineTool({
		name: "figma_create_dev_resource",
		label: "Figma: add dev resource (write)",
		description: "WRITE: attach a link (e.g. the PR implementing it) to a node as a Dev Mode resource.",
		parameters: Type.Object({ file: FILE, node_id: Type.String(), name: Type.String(), url: Type.String() }),
		async execute(_id, p) {
			const { ref, ids } = target(p.file, [p.node_id]);
			const r = await client.post("/v1/dev_resources", { dev_resources: [{ name: p.name, url: p.url, file_key: ref.key, node_id: ids[0] }] });
			return text(JSON.stringify(r));
		},
	});

	const deleteComment = defineTool({
		name: "figma_delete_comment",
		label: "Figma: delete comment (write)",
		description: "WRITE: delete one of your comments.",
		parameters: Type.Object({ file: FILE, comment_id: Type.String() }),
		async execute(_id, p, _s, _u, ctx) {
			const { ref } = target(p.file);
			await confirmWrite(ctx, "Delete Figma comment?", `Comment ${p.comment_id} in file ${ref.key} will be deleted.`);
			await client.request("DELETE", `/v1/files/${ref.key}/comments/${p.comment_id}`);
			return text(`Deleted comment ${p.comment_id}`);
		},
	});

	return [meta, component, styleByKey, teamStyles, published, updateVars, tokens, flows, texts, devResources, addDevResource, deleteComment];
}
