import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import figma from "../extensions/figma.ts";
import { card, components, styles, mockFetch } from "./fixtures.ts";

const KEY = "AbC123xyz90";
const realFetch = globalThis.fetch;
let tools: Record<string, any>;
let commands: Record<string, any>;
let sent: string[];
let calls: ReturnType<typeof mockFetch>["calls"];
const png = new Uint8Array([137, 80, 78, 71]);

beforeEach(() => {
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "figma-cfg-"));
	process.env.FIGMA_ACCESS_TOKEN = "figd_test";
	tools = {};
	commands = {};
	sent = [];
	const m = mockFetch({
		"/v1/me": () => ({ handle: "me", email: "m@x" }),
		[`/v1/files/${KEY}/nodes`]: (u) => ({ nodes: Object.fromEntries(u.searchParams.get("ids")!.split(",").map((id) => [id, id === "1:2" ? { document: card, components, styles } : id === "s1" ? { document: { id: "s1", fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] } } : id === "s2" ? { document: { id: "s2", style: { fontSize: 12 } } } : id === "s3" ? { document: { id: "s3", effects: [] } } : null])) }),
		[`/v1/files/${KEY}/comments`]: (_u, init) => (init?.method === "POST" ? { id: "c9" } : { comments: [{ id: "c1", user: { handle: "bob" }, message: "fix", client_meta: { node_id: "1:2" } }, { id: "c2", parent_id: "c1", user: { handle: "al" }, message: "done" }] }),
		[`/v1/files/${KEY}/variables/local`]: () => ({ meta: { variableCollections: { c: { name: "Colors", modes: [{ modeId: "m1", name: "Light" }], variableIds: ["v"] } }, variables: { v: { name: "brand/primary", resolvedType: "COLOR", valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 } } } } } }),
		[`/v1/files/${KEY}`]: () => ({ name: "Kit", version: "1", lastModified: "now", components: {}, styles: {}, document: { id: "0:0", type: "DOCUMENT", name: "Document", children: [{ id: "0:1", type: "CANVAS", name: "Page 1", children: [card] }] } }),
		"/v1/images/": () => ({ images: { "1:2": "https://img.test/a.png", "1:9": null } }),
		[`/v1/files/${KEY}/styles`]: () => ({ meta: { styles: [{ node_id: "s1", style_type: "FILL", name: "Brand" }, { node_id: "s2", style_type: "TEXT", name: "H1" }, { node_id: "s3", style_type: "EFFECT", name: "Shadow" }] } }),
		[`/v1/files/${KEY}/components`]: () => ({ meta: { components: [{ node_id: "9:9", key: "k1", name: "Button", description: "primary", containing_frame: { name: "Kit" } }] } }),
		[`/v1/files/${KEY}/component_sets`]: () => ({ meta: { component_sets: [{ node_id: "9:8", key: "k2", name: "Buttons" }] } }),
		"/v1/teams/7/components": () => ({ meta: { components: [{ node_id: "1:1", key: "t1", name: "TeamComp", file_key: KEY }] } }),
		"/v1/teams/7/component_sets": () => ({ meta: { component_sets: [] } }),
		[`/v1/files/${KEY}/meta`]: () => ({ file: { name: "Kit", folder_name: "F", creator: { handle: "c" }, last_touched_by: { handle: "l" }, last_touched_at: "t", editorType: "figma", link_access: "view" } }),
		[`/v1/files/${KEY}/variables/published`]: () => ({ meta: { variableCollections: { c: { id: "c", name: "Pub" } }, variables: { v: { variableCollectionId: "c", name: "x/y", resolvedType: "COLOR" } } } }),
		"/v1/components/": () => ({ meta: { name: "Btn", node_id: "1:1", file_key: KEY, description: "d" } }),
		"/v1/component_sets/": () => ({ meta: { name: "Btns", node_id: "1:1", file_key: KEY } }),
		"/v1/styles/": () => ({ meta: { name: "S", style_type: "FILL", node_id: "1:1", file_key: KEY, description: "desc" } }),
		"/v1/teams/7/styles": () => ({ meta: { styles: [{ style_type: "FILL", name: "Brand", key: "k", file_key: KEY, node_id: "1:1", description: "x" }, { style_type: "TEXT", name: "Other", key: "k2", file_key: KEY, node_id: "1:2" }] } }),
		[`/v1/files/${KEY}/dev_resources`]: () => ({ dev_resources: [{ node_id: "1:2", name: "PR", url: "https://gh/1", id: "d1" }] }),
		"/v1/dev_resources": () => ({ links_created: [{ id: "d2" }] }),
		[`/v1/files/${KEY}/comments/c1`]: () => ({}),
		[`/v1/files/${KEY}/versions`]: () => ({ versions: [{ id: "v1", created_at: "d", user: { handle: "u" }, label: "L", description: "D" }] }),
		[`/v1/files/${KEY}/images`]: () => ({ meta: { images: { abc: "https://img.test/abc.png" } } }),
		"/v1/projects/p1/files": () => ({ name: "Proj", files: [{ key: KEY, name: "Kit", last_modified: "t" }] }),
		"/v1/teams/7/projects": () => ({ name: "T", projects: [{ id: "p1", name: "Proj" }] }),
		"https://img.test": () => new Response(png),
	});
	calls = m.calls;
	globalThis.fetch = ((u: string, i?: RequestInit) => (u.startsWith("https://img.test") ? Promise.resolve(new Response(png, { headers: { "content-type": "image/png" } })) : m.fn(u, i))) as any;
	figma({
		registerTool: (t: any) => (tools[t.name] = t),
		registerCommand: (n: string, c: any) => (commands[n] = c),
		sendUserMessage: (s: string) => sent.push(s),
	} as any);
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const run = (name: string, params: any, cwd = tmpdir()) => tools[name].execute("id", params, undefined, undefined, { cwd });
const txt = (r: any) => r.content[0].text as string;

test("registers all tools and the command", () => {
	expect(Object.keys(tools).length).toBe(33);
	expect(Object.keys(tools).sort()).toEqual([
		"figma_create_dev_resource", "figma_desktop_call", "figma_desktop_selection", "figma_desktop_tools", "figma_delete_comment", "figma_export_tokens", "figma_get_component", "figma_get_dev_resources", "figma_get_file_meta",
		"figma_get_prototype_flows", "figma_get_published_variables", "figma_get_style", "figma_get_team_styles", "figma_get_text", "figma_update_variables",
		"figma_download_assets", "figma_download_image_fills", "figma_generate_code", "figma_get_comments", "figma_get_components", "figma_get_design_context",
		"figma_get_file_structure", "figma_get_node_raw", "figma_get_screenshot", "figma_get_styles", "figma_get_variables", "figma_get_versions",
		"figma_list_files", "figma_list_projects", "figma_parse_url", "figma_post_comment", "figma_search_nodes", "figma_whoami",
	].sort());
	expect(commands.figma).toBeTruthy();
});

test("file structure, design context, codegen, search", async () => {
	expect(txt(await run("figma_get_file_structure", { file: KEY }))).toContain('FRAME "Card" #1:2');
	const ctx = txt(await run("figma_get_design_context", { file: `https://www.figma.com/design/${KEY}/x?node-id=1-2` }));
	expect(ctx).toContain("<Button>");
	expect(ctx).toContain("## Assets");
	expect(txt(await run("figma_get_design_context", { file: KEY, node_ids: ["1:2", "9:9"], format: "json" }))).toContain("Not found: 9:9");
	expect(txt(await run("figma_generate_code", { file: KEY, node_id: "1:2", framework: "tailwind" }))).toContain("flex-col");
	expect(txt(await run("figma_search_nodes", { file: KEY, query: "/hello/", types: ["text"] }))).toContain('TEXT "Title"');
	expect(txt(await run("figma_search_nodes", { file: KEY, query: "zzz" }))).toBe("No matches.");
	await expect(run("figma_get_design_context", { file: KEY })).rejects.toThrow(/No node id/);
});

test("screenshot returns inline image and saves; assets download", async () => {
	const dir = mkdtempSync(join(tmpdir(), "figma-t-"));
	const r = await run("figma_get_screenshot", { file: KEY, node_ids: ["1:2", "1:9"], dir });
	expect(r.content.some((c: any) => c.type === "image")).toBe(true);
	expect(txt(r)).toContain("not renderable");
	expect([...readFileSync(join(dir, "1_2.png"))]).toEqual([...png]);
	const a = await run("figma_download_assets", { file: KEY, assets: [{ node_id: "1-2", filename: "card" }], format: "svg", dir });
	expect(txt(a)).toContain("card.svg");
	expect(calls.some((c) => c.url.searchParams.get("format") === "svg")).toBe(true);
});

test("variables, comments, whoami, projects", async () => {
	expect(txt(await run("figma_get_variables", { file: KEY }))).toContain("brand/primary [COLOR] Light=#ff0000");
	const c = txt(await run("figma_get_comments", { file: KEY }));
	expect(c).toContain("bob on #1:2");
	expect(c).toContain("↳ al: done");
	expect(txt(await run("figma_post_comment", { file: KEY, message: "hi", node_id: "1:2" }))).toContain("c9");
	expect(JSON.parse(calls.at(-1)!.init!.body as string).client_meta.node_id).toBe("1:2");
	expect(txt(await run("figma_whoami", {}))).toContain("me");
	expect(txt(await run("figma_list_projects", { team_id: "7" }))).toContain("project_id=p1");
	expect(txt(await run("figma_parse_url", { url: `https://figma.com/design/${KEY}?node-id=1-2` }))).toContain('"1:2"');
});

test("/figma command", async () => {
	const notes: string[] = [];
	const ctx = { ui: { notify: (m: string) => notes.push(m), select: async () => undefined, input: async () => undefined } } as any;
	await commands.figma.handler("whoami", ctx);
	await commands.figma.handler("team https://www.figma.com/files/team/42/x", ctx);
	await commands.figma.handler("teams", ctx);
	await commands.figma.handler("tools", ctx);
	expect(notes.at(-1)).toStartWith("33 figma tools");
	notes.pop();
	await commands.figma.handler("implement https://figma.com/design/AbC123xyz90/x?node-id=1-2 make it blue", ctx);
	await commands.figma.handler("open nonsense", ctx);
	await commands.figma.handler("bogus", ctx);
	await commands.figma.handler("", ctx);
	expect(notes[0]).toContain("REST: me <m@x>");
	expect(notes[0]).toContain("Desktop bridge: not reachable");
	expect(notes[1]).toContain("42");
	expect(sent[0]).toContain("make it blue");
	expect(notes.some((n) => n.includes("figma: Not a Figma URL"))).toBe(true);
	expect(notes.some((n) => n.includes("Unknown subcommand"))).toBe(true);
	expect(commands.figma.getArgumentCompletions("logi")).toEqual([{ value: "login", label: "login", description: "save a personal access token" }]);
});

test("/figma browse walks team -> project -> file -> frame", async () => {
	const m = mockFetch({
		"/v1/me": () => ({}),
		"/v1/teams/7/projects": () => ({ name: "T", projects: [{ id: "p1", name: "Proj" }] }),
		"/v1/projects/p1/files": () => ({ files: [{ key: KEY, name: "Kit", last_modified: "2025-01-02T00:00" }] }),
		[`/v1/files/${KEY}`]: () => ({ document: { children: [{ name: "Page", children: [{ id: "1:2", name: "Card", type: "FRAME" }] }] } }),
	});
	globalThis.fetch = m.fn as any;
	const answers = [0, 0, "Page / Card  [FRAME]"];
	let step = 0;
	const ctx = { ui: { notify() {}, input: async () => "https://www.figma.com/files/team/7/x", select: async (_t: string, opts: string[]) => (typeof answers[step] === "number" ? opts[answers[step++] as number] : answers[step++]) } } as any;
	await commands.figma.handler("", ctx);
	expect(sent[0]).toContain(`${KEY}?node-id=1-2`);
});

test("styles, components, versions, fills, raw, files", async () => {
	const st = txt(await run("figma_get_styles", { file: KEY }));
	expect(st).toContain('FILL "Brand" #s1 { background: #ff0000 }');
	expect(st).toContain("font-size: 12px");
	expect(txt(await run("figma_get_components", { file: KEY, query: "button" }))).toContain('SET "Buttons"');
	expect(txt(await run("figma_get_components", { team_id: "7" }))).toContain("TeamComp");
	await expect(run("figma_get_components", {})).rejects.toThrow(/file or team_id/);
	expect(txt(await run("figma_get_versions", { file: KEY }))).toContain("v1");
	expect(txt(await run("figma_list_files", { project_id: "p1" }))).toContain(`key=${KEY}`);
	expect(txt(await run("figma_get_node_raw", { file: KEY, node_ids: ["1:2"] }))).toContain('"1:2"');
	expect(txt(await run("figma_get_variables", { file: KEY, filter: "nomatch" }))).toContain("Colors");
	expect(txt(await run("figma_get_comments", { file: KEY, include_resolved: true }))).toContain("bob");
	expect(txt(await run("figma_post_comment", { file: KEY, message: "re", reply_to: "c1" }))).toContain("c9");
	expect(txt(await run("figma_download_image_fills", { file: KEY }))).toContain("abc");
	const dir = mkdtempSync(join(tmpdir(), "figma-t-"));
	const f = txt(await run("figma_download_image_fills", { file: KEY, refs: ["abc", "nope"], dir }));
	expect(f).toContain("abc.png");
	expect(f).toContain("nope: not found");
	expect(txt(await run("figma_get_file_structure", { file: KEY, depth: 3 }))).toContain("Kit");
});

test("/figma login/logout/usage paths", async () => {
	const notes: string[] = [];
	const ctx = { ui: { notify: (m: string) => notes.push(m), select: async () => undefined, input: async () => undefined } } as any;
	delete process.env.FIGMA_ACCESS_TOKEN;
	await commands.figma.handler("login", ctx);
	await commands.figma.handler("login figd_bad", ctx); // /v1/me mocked ok
	await commands.figma.handler("logout", ctx);
	await commands.figma.handler("login figd_bad", ctx);
	process.env.FIGMA_ACCESS_TOKEN = "figd_env";
	await commands.figma.handler("logout", ctx);
	await commands.figma.handler("team", ctx);
	await commands.figma.handler("open", ctx);
	await commands.figma.handler("implement", ctx);
	await commands.figma.handler("help", ctx);
	await commands.figma.handler("teams", ctx);
	expect(notes[0]).toContain("Usage: /figma login");
	expect(notes[1]).toContain("Logged in as me");
	expect(notes[2]).toBe("Logged out.");
	expect(notes[4]).toContain("env is still set");
	expect(notes.at(-2)).toContain("/figma browse".slice(0, 6));
	expect(notes.at(-1)).toContain("No teams");
});

test("/figma browse with several teams, back navigation, whole-file explore", async () => {
	const m = mockFetch({
		"/v1/teams/1/projects": () => ({ name: "T1", projects: [{ id: "p1", name: "P" }] }),
		"/v1/teams/2/projects": () => ({ name: "T2", projects: [] }),
		"/v1/projects/p1/files": () => ({ files: [] }),
	});
	globalThis.fetch = m.fn as any;
	const notes: string[] = [];
	const seq: (string | undefined)[] = ["2"];
	const ctx = { ui: { notify: (x: string) => notes.push(x), input: async () => undefined, select: async () => seq.shift() } } as any;
	await commands.figma.handler("team 1", ctx);
	await commands.figma.handler("team 2", ctx);
	await commands.figma.handler("", ctx);
	expect(notes.at(-1)).toContain("No projects");
	// team 1: project -> no files -> back
	seq.push("1", "P", "← back");
	await commands.figma.handler("", ctx);
	expect(notes.at(-1)).toBe("Project has no files.");
});

test("extra tools: meta, lookups, published, tokens, flows, text, dev resources, delete", async () => {
	expect(txt(await run("figma_get_file_meta", { file: KEY }))).toContain("last touched by l");
	expect(txt(await run("figma_get_component", { key: "abc" }))).toContain("Btn (1:1)");
	expect(txt(await run("figma_get_component", { key: "abc", kind: "component_set" }))).toContain("Btns");
	expect(txt(await run("figma_get_style", { key: "abc" }))).toContain('FILL "S"');
	const ts = txt(await run("figma_get_team_styles", { team_id: "7", query: "bra" }));
	expect(ts).toContain("Brand");
	expect(ts).not.toContain("Other");
	expect(txt(await run("figma_get_published_variables", { file: KEY }))).toContain("- x/y [COLOR]");
	expect(txt(await run("figma_get_dev_resources", { file: KEY, node_ids: ["1:2"] }))).toContain("https://gh/1");
	expect(txt(await run("figma_create_dev_resource", { file: KEY, node_id: "1-2", name: "PR", url: "u" }))).toContain("d2");
	expect(JSON.parse(calls.at(-1)!.init!.body as string).dev_resources[0].node_id).toBe("1:2");
	expect(txt(await run("figma_delete_comment", { file: KEY, comment_id: "c1" }))).toContain("Deleted");
	expect(calls.at(-1)!.init!.method).toBe("DELETE");
	const t = txt(await run("figma_get_text", { file: KEY, node_ids: ["1:2"] }));
	expect(t).toContain('#1:3 [Card] (20px) "Hello <World>"');
	await expect(run("figma_get_text", { file: KEY })).rejects.toThrow(/No node id/);
	expect(txt(await run("figma_get_prototype_flows", { file: KEY, page: "page" }))).toContain("(none)");
	expect(txt(await run("figma_generate_code", { file: KEY, node_id: "1:2", framework: "compose" }))).toContain("import androidx.compose.foundation.layout.Column");
});

test("export tokens: variables, styles fallback, errors", async () => {
	const css = txt(await run("figma_export_tokens", { file: KEY }));
	expect(css).toContain("1 tokens from variables");
	expect(css).toContain("--brand-primary: #ff0000;");
	expect(txt(await run("figma_export_tokens", { file: KEY, format: "json" }))).toContain('"brand"');
	expect(txt(await run("figma_export_tokens", { file: KEY, format: "tailwind", selector: ".t" }))).toContain("theme: { extend");
	const st = txt(await run("figma_export_tokens", { file: KEY, source: "styles" }));
	expect(st).toContain("from styles");
	expect(st).toContain("--brand: #ff0000;");
	// variables endpoint forbidden -> auto falls back to styles; explicit variables source throws
	const K2 = "ZzZ123xyz90";
	globalThis.fetch = mockFetch({
		[`/v1/files/${K2}/variables/local`]: () => new Response("{}", { status: 403 }),
		[`/v1/files/${K2}/styles`]: () => ({ meta: { styles: [] } }),
	}).fn as any;
	await expect(run("figma_export_tokens", { file: K2, source: "variables" })).rejects.toThrow(/403/);
	expect(txt(await run("figma_export_tokens", { file: K2 }))).toContain("No tokens found");
	await expect(run("figma_update_variables", { file: K2, body: {} })).rejects.toThrow();
});

test("desktop bridge uses FIGMA_MCP_URL", async () => {
	process.env.FIGMA_MCP_URL = "http://localhost:9999/mcp";
	try {
		globalThis.fetch = (async (u: any, init: any) => {
			const b = JSON.parse(init.body);
			calls.push({ url: new URL(String(u)), init } as any);
			return b.id === undefined ? new Response(null, { status: 202 }) : Response.json({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "get_metadata" }] } });
		}) as any;
		expect(txt(await run("figma_desktop_tools", {}))).toContain("http://localhost:9999/mcp: 1 tools");
	} finally {
		delete process.env.FIGMA_MCP_URL;
	}
});

test("/figma whoami: connected bridge and REST error", async () => {
	const notes: string[] = [];
	const ctx = { ui: { notify: (m: string) => notes.push(m) } } as any;
	globalThis.fetch = (async (u: any, init: any) => {
		if (String(u).includes("/v1/me")) return new Response("{}", { status: 403 });
		const b = JSON.parse(init.body);
		return b.id === undefined ? new Response(null, { status: 202 }) : Response.json({ jsonrpc: "2.0", id: b.id, result: { tools: [{ name: "a" }, { name: "b" }] } });
	}) as any;
	await commands.figma.handler("whoami", ctx);
	expect(notes[0]).toContain("REST: ");
	expect(notes[0]).toContain("Desktop bridge: connected, 2 tools");
});

test("coverage gaps: config file, assets not renderable, variables write, login check failure", async () => {
	const { loadConfig, saveConfig } = await import("../extensions/core/config.ts");
	await saveConfig({ token: "t", teamIds: ["1"], baseUrl: "http://b", desktopUrl: "http://d/mcp" });
	expect(await loadConfig()).toEqual({ token: "t", teamIds: ["1"], baseUrl: "http://b", desktopUrl: "http://d/mcp" });
	await Bun.write(join(process.env.PI_CODING_AGENT_DIR!, "figma.json"), JSON.stringify({ token: 1, teamIds: "x", baseUrl: 2, desktopUrl: 3 }));
	expect(await loadConfig()).toEqual({ token: undefined, teamIds: [], baseUrl: undefined, desktopUrl: undefined });
	const dir = mkdtempSync(join(tmpdir(), "figma-a-"));
	expect(txt(await run("figma_download_assets", { file: KEY, assets: [{ node_id: "1:9", filename: "x" }], dir }))).toContain("not renderable");
	globalThis.fetch = mockFetch({ [`/v1/files/${KEY}/variables`]: () => ({ meta: { ok: true } }) }).fn as any;
	expect(txt(await run("figma_update_variables", { file: KEY, body: { variables: [] } }))).toContain("ok");
	globalThis.fetch = mockFetch({ "/v1/me": () => new Response(JSON.stringify({ message: "bad" }), { status: 401 }) }).fn as any;
	const notes: string[] = [];
	await commands.figma.handler("login figd_x", { ui: { notify: (m: string) => notes.push(m) } } as any);
	expect(notes.at(-1)).toContain("check failed: Figma API 401 (unauthorized: check your token): bad");
});

test("tool calls run inside their abort signal", async () => {
	const ac = new AbortController();
	ac.abort(new Error("cancelled by user"));
	await expect(tools.figma_whoami.execute("id", {}, ac.signal, undefined, { cwd: tmpdir() })).rejects.toThrow("cancelled by user");
	expect(txt(await run("figma_whoami", {}))).toContain("me");
});
