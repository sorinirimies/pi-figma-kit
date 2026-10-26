/** /figma command: login, whoami, team management, interactive browser (team → project → file → frame). */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FigmaClient } from "../core/api.ts";
import { type FigmaConfig, envToken, saveConfig } from "../core/config.ts";
import { parseFigmaRef } from "../core/url.ts";

export interface CommandHost {
	pi: ExtensionAPI;
	client: FigmaClient;
	config: FigmaConfig;
}

export const USAGE = [
	"/figma                 interactive browser (team → project → file → frame)",
	"/figma login <token>   save a personal access token",
	"/figma logout          forget the saved token",
	"/figma whoami          check the token",
	"/figma team <id|url>   add a team to the browser (id from figma.com/files/team/<ID>)",
	"/figma teams           list configured teams",
	"/figma open <url>      have the agent inspect a Figma link",
	"/figma implement <url> [instructions]   fetch the design and implement it",
].join("\n");

export const parseTeamId = (s: string): string => /\/team\/(\d+)/.exec(s)?.[1] ?? s.trim();

export function completions(prefix: string) {
	const subs = ["login", "logout", "whoami", "team", "teams", "open", "implement", "help"];
	const items = subs.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s }));
	return items.length ? items : null;
}

const BACK = "← back";

async function pick(ctx: ExtensionContext, title: string, options: string[]): Promise<number | undefined> {
	const choice = await ctx.ui.select(title, [...options, BACK]);
	if (choice === undefined || choice === BACK) return undefined;
	return options.indexOf(choice);
}

async function browse(h: CommandHost, ctx: ExtensionContext) {
	let teams = h.config.teamIds;
	if (!teams.length) {
		const t = await ctx.ui.input("Figma team id or URL", "figma.com/files/team/<ID>/…");
		if (!t) return;
		h.config.teamIds = teams = [parseTeamId(t)];
		await saveConfig(h.config);
	}
	let ti = 0;
	if (teams.length > 1) {
		const i = await pick(ctx, "Team", teams);
		if (i === undefined) return;
		ti = i;
	}
	const team = await h.client.get(`/v1/teams/${teams[ti]}/projects`);
	const projects: any[] = team.projects ?? [];
	if (!projects.length) return void ctx.ui.notify("No projects in this team.", "info");
	for (;;) {
		const pi = await pick(ctx, `${team.name ?? "Team"}: project`, projects.map((p) => p.name));
		if (pi === undefined) return;
		const files: any[] = (await h.client.get(`/v1/projects/${projects[pi].id}/files`)).files ?? [];
		if (!files.length) {
			ctx.ui.notify("Project has no files.", "info");
			continue;
		}
		for (;;) {
			const fi = await pick(ctx, `${projects[pi].name}: file`, files.map((f) => `${f.name}  (${String(f.last_modified).slice(0, 10)})`));
			if (fi === undefined) break;
			const file = files[fi];
			const doc = await h.client.get(`/v1/files/${file.key}`, { depth: 2 });
			const frames: { label: string; id: string }[] = [];
			for (const page of doc.document.children ?? []) for (const f of page.children ?? []) frames.push({ label: `${page.name} / ${f.name}  [${f.type}]`, id: f.id });
			const choice = await ctx.ui.select(`${file.name}`, ["Explore whole file (agent)", ...frames.map((f) => f.label), BACK]);
			if (!choice || choice === BACK) continue;
			const url = `https://www.figma.com/design/${file.key}`;
			if (choice.startsWith("Explore whole")) h.pi.sendUserMessage(`Explore this Figma file with the figma_* tools and summarize its structure: ${url}`);
			else {
				const f = frames[[...frames.map((x) => x.label)].indexOf(choice)]!;
				h.pi.sendUserMessage(`Look at this Figma frame with figma_get_design_context and figma_get_screenshot, and describe it: ${url}?node-id=${f.id.replace(/:/g, "-")}`);
			}
			return;
		}
	}
}

export async function runCommand(args: string, h: CommandHost, ctx: ExtensionContext): Promise<void> {
	const [sub = "", ...rest] = args.trim().split(/\s+/);
	const arg = rest.join(" ");
	switch (sub) {
		case "":
		case "browse":
			return browse(h, ctx);
		case "help":
			return ctx.ui.notify(USAGE, "info");
		case "login":
			if (!arg) return ctx.ui.notify("Usage: /figma login <personal-access-token>", "warning");
			h.config.token = arg;
			await saveConfig(h.config);
			h.client.clearCache();
			try {
				const me = await h.client.get("/v1/me");
				ctx.ui.notify(`Logged in as ${me.handle}`, "info");
			} catch (e) {
				ctx.ui.notify(`Token saved, but check failed: ${(e as Error).message}`, "warning");
			}
			return;
		case "logout":
			delete h.config.token;
			await saveConfig(h.config);
			h.client.clearCache();
			return ctx.ui.notify(envToken() ? "Saved token removed (FIGMA_ACCESS_TOKEN env is still set)." : "Logged out.", "info");
		case "whoami": {
			const me = await h.client.get("/v1/me");
			return ctx.ui.notify(`${me.handle} <${me.email}>`, "info");
		}
		case "team":
			if (!arg) return ctx.ui.notify("Usage: /figma team <id|url>", "warning");
			if (!h.config.teamIds.includes(parseTeamId(arg))) h.config.teamIds.push(parseTeamId(arg));
			await saveConfig(h.config);
			return ctx.ui.notify(`Teams: ${h.config.teamIds.join(", ")}`, "info");
		case "teams":
			return ctx.ui.notify(h.config.teamIds.length ? `Teams: ${h.config.teamIds.join(", ")}` : "No teams. /figma team <id>", "info");
		case "open": {
			if (!arg) return ctx.ui.notify("Usage: /figma open <url>", "warning");
			parseFigmaRef(arg.split(/\s+/)[0]!);
			return h.pi.sendUserMessage(`Inspect this Figma link with the figma_* tools (structure, design context, screenshot) and summarize it: ${arg}`);
		}
		case "implement": {
			const [url, ...ins] = rest;
			if (!url) return ctx.ui.notify("Usage: /figma implement <url> [instructions]", "warning");
			parseFigmaRef(url);
			return h.pi.sendUserMessage(`Implement this Figma design in the current project: ${url}\nUse figma_get_design_context, figma_get_screenshot, figma_download_assets (and figma_get_variables/figma_get_styles for tokens). Follow the project's existing components and conventions.${ins.length ? `\n${ins.join(" ")}` : ""}`);
		}
		default:
			return ctx.ui.notify(`Unknown subcommand "${sub}".\n${USAGE}`, "warning");
	}
}
