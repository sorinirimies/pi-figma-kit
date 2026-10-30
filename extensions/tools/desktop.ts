/** Bridge to the Figma desktop app's MCP server: live selection, Dev Mode code, Code Connect. */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { McpClient, McpResult } from "../core/mcp.ts";
import { clip } from "./util.ts";

function convert(r: McpResult) {
	const content = r.content.map((c) => (c.type === "image" && c.data ? { type: "image" as const, data: c.data, mimeType: c.mimeType ?? "image/png" } : { type: "text" as const, text: clip(c.text ?? JSON.stringify(c)) }));
	if (!content.length) content.push({ type: "text", text: "(empty result)" });
	return { content, details: { isError: !!r.isError } };
}

export function desktopTools({ mcp }: { mcp: McpClient }) {
	const tools = defineTool({
		name: "figma_desktop_tools",
		label: "Figma desktop: list tools",
		description: "Tools and args of the Figma desktop app's MCP server (Dev Mode → desktop MCP server). Also a connectivity check.",
		parameters: Type.Object({}),
		async execute() {
			const list = await mcp.listTools();
			const t = list.map((x) => `- ${x.name}: ${(x.description ?? "").split("\n")[0]}\n  args: ${JSON.stringify(x.inputSchema?.properties ?? {})}${x.inputSchema?.required?.length ? ` required: ${x.inputSchema.required.join(", ")}` : ""}`).join("\n");
			return { content: [{ type: "text" as const, text: `${mcp.url}: ${list.length} tools\n${t}` }], details: { tools: list.map((x) => x.name) } };
		},
	});

	const call = defineTool({
		name: "figma_desktop_call",
		label: "Figma desktop: call tool",
		description:
			"Call a Figma desktop MCP tool; without nodeId it acts on the current selection. E.g. get_design_context (with Code Connect), get_metadata, get_screenshot, get_variable_defs, get_code_connect_map. Names/args: figma_desktop_tools.",
		promptSnippet: "Use the user's live Figma selection / Dev Mode / Code Connect via the desktop app",
		parameters: Type.Object({
			tool: Type.String(),
			arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'e.g. {"nodeId":"1:2","clientFrameworks":"compose"}' })),
		}),
		async execute(_id, p) {
			return convert(await mcp.callTool(p.tool, p.arguments ?? {}));
		},
	});

	const selection = defineTool({
		name: "figma_desktop_selection",
		label: "Figma desktop: current selection",
		description: "Design context (and optional screenshot) of the current selection in the Figma desktop app, or of a node id.",
		promptSnippet: "Read the frame currently selected in Figma",
		parameters: Type.Object({
			node_id: Type.Optional(Type.String({ description: "default: selection" })),
			language: Type.Optional(Type.String({ description: 'e.g. "kotlin"' })),
			framework: Type.Optional(Type.String({ description: 'e.g. "compose"' })),
			screenshot: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, p) {
			const base: Record<string, unknown> = {};
			if (p.node_id) base.nodeId = p.node_id.replace(/-/g, ":");
			const ctx = await mcp.callTool("get_design_context", { ...base, ...(p.language ? { clientLanguages: p.language } : {}), ...(p.framework ? { clientFrameworks: p.framework } : {}) });
			const out = convert(ctx);
			if (p.screenshot) {
				const shot = convert(await mcp.callTool("get_screenshot", base));
				out.content.push(...shot.content);
			}
			return out;
		},
	});

	return [tools, call, selection];
}
