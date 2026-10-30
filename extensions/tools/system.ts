/** Design-system data: variables (tokens), styles, components. */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { color, fillCss, textCss, cssString } from "../design/css.ts";
import { type Ctx, FILE, fetchNodes, nodeUrl, target, text } from "./util.ts";

const fmtValue = (v: any): string =>
	v && typeof v === "object" && "r" in v ? color(v) : v && typeof v === "object" && v.type === "VARIABLE_ALIAS" ? `alias(${v.id})` : JSON.stringify(v);

export function systemTools({ client }: Ctx) {
	const variables = defineTool({
		name: "figma_get_variables",
		label: "Figma: variables",
		description: "Local variables (design tokens) by collection, with values per mode. Needs file_variables:read (Enterprise); else use figma_get_styles.",
		promptSnippet: "Read a Figma file's design tokens (variables)",
		parameters: Type.Object({ file: FILE, filter: Type.Optional(Type.String({ description: "name substring" })) }),
		async execute(_id, p) {
			const { ref } = target(p.file);
			const r = await client.get(`/v1/files/${ref.key}/variables/local`);
			const { variables: vars = {}, variableCollections: cols = {} } = r.meta ?? {};
			const lines: string[] = [];
			for (const c of Object.values<any>(cols)) {
				const modes: Record<string, string> = Object.fromEntries(c.modes.map((m: any) => [m.modeId, m.name]));
				lines.push(`## ${c.name} (modes: ${c.modes.map((m: any) => m.name).join(", ")})`);
				for (const vid of c.variableIds) {
					const v = vars[vid];
					if (!v || (p.filter && !v.name.toLowerCase().includes(p.filter.toLowerCase()))) continue;
					const vals = Object.entries(v.valuesByMode).map(([m, x]) => `${modes[m] ?? m}=${fmtValue(x)}`).join(" | ");
					lines.push(`- ${v.name} [${v.resolvedType}] ${vals}`);
				}
			}
			return text(lines.join("\n") || "No variables.");
		},
	});

	const styles = defineTool({
		name: "figma_get_styles",
		label: "Figma: styles",
		description: "Styles of a file (color, text, effect, grid) with resolved CSS.",
		parameters: Type.Object({ file: FILE }),
		async execute(_id, p) {
			const { ref } = target(p.file);
			const r = await client.get(`/v1/files/${ref.key}/styles`);
			const list: any[] = r.meta?.styles ?? [];
			if (!list.length) return text("No styles.");
			const byNode = new Map(list.map((s) => [s.node_id, s]));
			const resolved = await fetchNodes(client, ref.key, [...byNode.keys()].slice(0, 200), 0);
			const lines = list.map((s) => `${s.style_type} "${s.name}" #${s.node_id}`);
			for (const d of resolved.docs) {
				const s = byNode.get(d.id);
				let css = "";
				if (s?.style_type === "FILL") css = cssString(fillCss(d.fills));
				else if (s?.style_type === "TEXT") css = cssString(textCss(d.style));
				else if (s?.style_type === "EFFECT") css = JSON.stringify(d.effects);
				if (s && css) lines[list.indexOf(s)] += ` { ${css} }`;
			}
			return text(lines.join("\n"), { count: list.length });
		},
	});

	const components = defineTool({
		name: "figma_get_components",
		label: "Figma: components",
		description: "Components and component sets of a file or a team library (team_id): names, keys, node ids, descriptions.",
		parameters: Type.Object({ file: Type.Optional(FILE), team_id: Type.Optional(Type.String()), query: Type.Optional(Type.String()), limit: Type.Optional(Type.Number({ default: 100 })) }),
		async execute(_id, p) {
			let comps: any[] = [];
			let sets: any[] = [];
			let key = "";
			if (p.file) {
				key = target(p.file).ref.key;
				comps = (await client.get(`/v1/files/${key}/components`)).meta?.components ?? [];
				sets = (await client.get(`/v1/files/${key}/component_sets`)).meta?.component_sets ?? [];
			} else if (p.team_id) {
				comps = (await client.get(`/v1/teams/${p.team_id}/components`, { page_size: 100 })).meta?.components ?? [];
				sets = (await client.get(`/v1/teams/${p.team_id}/component_sets`, { page_size: 100 })).meta?.component_sets ?? [];
			} else throw new Error("Pass file or team_id.");
			const q = p.query?.toLowerCase();
			const keep = (c: any) => !q || `${c.name} ${c.description ?? ""}`.toLowerCase().includes(q);
			const fmt = (kind: string) => (c: any) => `${kind} "${c.name}" #${c.node_id} key=${c.key}${c.containing_frame?.name ? ` in "${c.containing_frame.name}"` : ""}${c.description ? ` — ${c.description}` : ""}${c.file_key ? ` ${nodeUrl(c.file_key, c.node_id)}` : ""}`;
			const lines = [...sets.filter(keep).map(fmt("SET")), ...comps.filter(keep).map(fmt("COMPONENT"))].slice(0, p.limit ?? 100);
			return text(lines.join("\n") || "No components.", { count: lines.length });
		},
	});

	return [variables, styles, components];
}
