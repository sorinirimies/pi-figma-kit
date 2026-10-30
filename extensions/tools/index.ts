import type { ToolAnnotations, ToolNamespace } from "@earendil-works/pi-coding-agent";
import { assetTools } from "./assets.ts";
import { browseTools } from "./browse.ts";
import { desktopTools } from "./desktop.ts";
import { extraTools } from "./extra.ts";
import { readTools } from "./read.ts";
import { systemTools } from "./system.ts";
import type { Ctx } from "./util.ts";

/**
 * Usage guidance shared by all figma_* tools. Stated once here (attached to figma_get_design_context)
 * instead of being repeated in every tool and parameter description.
 */
export const GUIDELINES = [
	"Figma tools take a Figma URL or file key; when node ids are omitted, the URL's ?node-id= is used. Find ids with figma_get_file_structure or figma_search_nodes.",
	"For Figma-to-code: figma_get_design_context (or figma_generate_code for a scaffold), then figma_get_screenshot to compare visually, and figma_download_assets for icons (svg) and images (png/jpg, scale 2-3). Verify the result with figma_compare (PNG screenshot of your UI).",
	"Figma write tools (post/delete comment, create dev resource, update variables) only when the user asks.",
];

export const NAMESPACE: ToolNamespace = {
	name: "figma",
	description: "Figma REST API (files, design context, codegen, renders, assets, tokens, comments) and the Figma desktop app bridge.",
	instructions: GUIDELINES.join("\n"),
};

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
/** Remote writes and local file writes; everything else is read-only. */
const ANNOTATIONS: Record<string, ToolAnnotations> = {
	figma_post_comment: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
	figma_create_dev_resource: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
	figma_delete_comment: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
	figma_update_variables: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
	// Save files into the project (may overwrite same-named files).
	figma_download_assets: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
	figma_download_image_fills: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
	figma_get_screenshot: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
	// Writes only the diff image into the temp dir.
	figma_compare: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	// Arbitrary desktop MCP tool: unknown effects, keep the conservative defaults.
	figma_desktop_call: {},
};

export function allTools(ctx: Ctx) {
	const tools = [...readTools(ctx), ...assetTools(ctx), ...systemTools(ctx), ...browseTools(ctx), ...extraTools(ctx), ...desktopTools(ctx)];
	return tools.map((t) => ({
		...t,
		namespace: NAMESPACE,
		annotations: ANNOTATIONS[t.name] ?? READ,
		...(t.name === "figma_get_design_context" ? { promptGuidelines: GUIDELINES } : {}),
	}));
}
