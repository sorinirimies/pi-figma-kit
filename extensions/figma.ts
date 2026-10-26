/**
 * pi-figma-kit: Figma for pi. Registers figma_* tools (explore files, design context, code scaffolds,
 * screenshots, asset export, variables/styles/components, comments) and a /figma command (login + browser).
 *
 *   core/     url parsing, config (token), REST client
 *   design/   Figma JSON -> CSS, compact design tree, code generators
 *   tools/    the model-facing tools
 *   command/  /figma
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completions, runCommand } from "./command/figma-command.ts";
import { FigmaClient } from "./core/api.ts";
import { type FigmaConfig, envToken, loadConfig } from "./core/config.ts";
import { allTools } from "./tools/index.ts";

export * from "./core/url.ts";
export * from "./design/css.ts";
export * from "./design/simplify.ts";
export * from "./design/codegen.ts";

export default function figmaExtension(pi: ExtensionAPI) {
	const config: FigmaConfig = { teamIds: [] };
	const client = new FigmaClient({
		getToken: () => envToken() ?? config.token,
		baseUrl: () => config.baseUrl,
	});
	// Tools read the saved config lazily on first use so registration stays synchronous.
	const ready = loadConfig().then((c) => Object.assign(config, c));
	for (const tool of allTools({ client })) {
		const exec = tool.execute;
		pi.registerTool({ ...tool, execute: async (...a: Parameters<typeof exec>) => (await ready, exec(...a)) } as typeof tool);
	}

	pi.registerCommand("figma", {
		description: "Figma: browse projects/files, /figma login <token>, open <url>, implement <url>",
		getArgumentCompletions: completions,
		handler: async (args, ctx) => {
			await ready;
			try {
				await runCommand(args, { pi, client, config }, ctx);
			} catch (e) {
				ctx.ui.notify(`figma: ${(e as Error).message}`, "error");
			}
		},
	});
}
