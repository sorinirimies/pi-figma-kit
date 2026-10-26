/**
 * A tiny fake of Figma's REST API and of the desktop MCP server, for the demo recordings
 * (no token, no network, no real files). One fictional file: "Acme Mobile".
 *
 *   bun examples/vhs/mock-figma.ts [port]      (default 8990)
 *   REST:  http://127.0.0.1:8990/v1/...     (pi-figma-kit baseUrl)
 *   MCP:   http://127.0.0.1:8990/mcp        (pi-figma-kit desktopUrl)
 */
const port = Number(process.argv[2] ?? 8990);
export const KEY = "AcMeApp0Kit1";

const rgb = (r: number, g: number, b: number, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a });
const solid = (c: ReturnType<typeof rgb>) => [{ type: "SOLID", color: c }];
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const text = (id: string, name: string, characters: string, size: number, weight: number, color = rgb(17, 24, 39), extra: object = {}) => ({
	id, name, type: "TEXT", characters, fills: solid(color), layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", absoluteBoundingBox: box(0, 0, 300, size * 1.3),
	style: { fontFamily: "Inter", fontSize: size, fontWeight: weight, lineHeightPx: Math.round(size * 1.3), letterSpacing: 0, textAlignHorizontal: "LEFT" }, ...extra,
});
const button = (id: string, label: string, bg = rgb(37, 99, 235), fg = rgb(255, 255, 255)) => ({
	id, name: "Button", type: "INSTANCE", componentId: "9:1", layoutMode: "HORIZONTAL", primaryAxisAlignItems: "CENTER", counterAxisAlignItems: "CENTER",
	paddingLeft: 24, paddingRight: 24, paddingTop: 14, paddingBottom: 14, cornerRadius: 14, layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG",
	absoluteBoundingBox: box(0, 0, 300, 52), fills: solid(bg), styles: { fill: "S:1" },
	interactions: [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", destinationId: "2:1", navigation: "NAVIGATE" }] }],
	children: [text(`${id}1`, "Label", label, 16, 600, fg, { layoutSizingHorizontal: "HUG" })],
});
const icon = (id: string, name: string) => ({ id, name, type: "FRAME", absoluteBoundingBox: box(0, 0, 24, 24), children: [{ id: `${id}1`, name: "Vector", type: "VECTOR" }] });

const welcome = {
	id: "1:1", name: "Welcome", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 24, paddingTop: 64, paddingBottom: 32, paddingLeft: 24, paddingRight: 24,
	primaryAxisAlignItems: "SPACE_BETWEEN", counterAxisAlignItems: "CENTER", layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED",
	absoluteBoundingBox: box(0, 0, 360, 780), fills: [{ type: "GRADIENT_LINEAR", gradientHandlePositions: [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 0 }], gradientStops: [{ position: 0, color: rgb(238, 242, 255) }, { position: 1, color: rgb(255, 255, 255) }] }],
	children: [
		{ id: "1:2", name: "Hero", type: "RECTANGLE", cornerRadius: 28, layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED", absoluteBoundingBox: box(0, 0, 312, 320), fills: [{ type: "IMAGE", imageRef: "hero-illustration", scaleMode: "FILL" }] },
		{ id: "1:3", name: "Copy", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 8, layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", absoluteBoundingBox: box(0, 0, 312, 120), children: [
			text("1:4", "Title", "Plan trips together", 32, 700, rgb(17, 24, 39), { characterStyleOverrides: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1], styleOverrideTable: { "1": { fills: solid(rgb(37, 99, 235)) } } }),
			text("1:5", "Subtitle", "Share itineraries, split costs and keep every booking in one place.", 16, 400, rgb(75, 85, 99)),
		] },
		{ id: "1:6", name: "Actions", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 12, layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", absoluteBoundingBox: box(0, 0, 312, 116), children: [
			button("1:7", "Get started"), button("1:8", "I already have an account", rgb(243, 244, 246), rgb(17, 24, 39)),
		] },
	],
};
const profile = {
	id: "2:1", name: "Profile card", type: "FRAME", layoutMode: "HORIZONTAL", itemSpacing: 16, paddingTop: 16, paddingBottom: 16, paddingLeft: 16, paddingRight: 16,
	counterAxisAlignItems: "CENTER", cornerRadius: 20, layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG", absoluteBoundingBox: box(400, 0, 328, 96),
	fills: solid(rgb(255, 255, 255)), strokes: solid(rgb(0, 0, 0, 0.08)), strokeWeight: 1, effects: [{ type: "DROP_SHADOW", offset: { x: 0, y: 8 }, radius: 24, spread: 0, color: rgb(0, 0, 0, 0.12) }],
	children: [
		{ id: "2:2", name: "Avatar", type: "ELLIPSE", absoluteBoundingBox: box(0, 0, 64, 64), fills: [{ type: "IMAGE", imageRef: "avatar-mia", scaleMode: "FILL" }] },
		{ id: "2:3", name: "Details", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 4, layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG", absoluteBoundingBox: box(0, 0, 180, 48), children: [
			text("2:4", "Name", "Mia Hansen", 18, 600), text("2:5", "Role", "Trip organiser · Lisbon", 14, 400, rgb(107, 114, 128)),
		] },
		icon("2:6", "Chevron"),
	],
};
const doc = {
	id: "0:0", name: "Document", type: "DOCUMENT", children: [
		{ id: "0:1", name: "Onboarding", type: "CANVAS", flowStartingPoints: [{ nodeId: "1:1", name: "First run" }], children: [welcome, profile] },
		{ id: "0:2", name: "Components", type: "CANVAS", children: [{ id: "9:1", name: "Button", type: "COMPONENT", absoluteBoundingBox: box(0, 0, 300, 52) }] },
	],
};
const index = new Map<string, any>();
(function walk(n: any) { index.set(n.id, n); (n.children ?? []).forEach(walk); })(doc);

const variables = {
	meta: {
		variableCollections: {
			c1: { id: "c1", name: "Color", modes: [{ modeId: "m1", name: "Light" }, { modeId: "m2", name: "Dark" }], variableIds: ["v1", "v2", "v3", "v4"] },
			c2: { id: "c2", name: "Space", modes: [{ modeId: "m3", name: "Default" }], variableIds: ["v5", "v6"] },
		},
		variables: {
			v1: { id: "v1", name: "brand/primary", resolvedType: "COLOR", valuesByMode: { m1: rgb(37, 99, 235), m2: rgb(96, 165, 250) } },
			v2: { id: "v2", name: "surface/default", resolvedType: "COLOR", valuesByMode: { m1: rgb(255, 255, 255), m2: rgb(17, 24, 39) } },
			v3: { id: "v3", name: "text/default", resolvedType: "COLOR", valuesByMode: { m1: rgb(17, 24, 39), m2: rgb(243, 244, 246) } },
			v4: { id: "v4", name: "button/background", resolvedType: "COLOR", valuesByMode: { m1: { type: "VARIABLE_ALIAS", id: "v1" }, m2: { type: "VARIABLE_ALIAS", id: "v1" } } },
			v5: { id: "v5", name: "space/md", resolvedType: "FLOAT", valuesByMode: { m3: 16 } },
			v6: { id: "v6", name: "radius/lg", resolvedType: "FLOAT", valuesByMode: { m3: 20 } },
		},
	},
};

const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const json = (v: unknown, status = 200) => Response.json(v, { status });

const tools = [
	{ name: "get_design_context", description: "Design context for the selected node: layout, styles, Code Connect snippets.", inputSchema: { type: "object", properties: { nodeId: { type: "string" }, clientLanguages: { type: "string" }, clientFrameworks: { type: "string" } } } },
	{ name: "get_metadata", description: "Sparse XML of the selection: ids, names, types, positions, sizes.", inputSchema: { type: "object", properties: { nodeId: { type: "string" } } } },
	{ name: "get_screenshot", description: "Screenshot of the selection.", inputSchema: { type: "object", properties: { nodeId: { type: "string" } } } },
	{ name: "get_variable_defs", description: "Variables used by the selection.", inputSchema: { type: "object", properties: { nodeId: { type: "string" } } } },
	{ name: "get_code_connect_map", description: "Mapping of Figma nodes to code components.", inputSchema: { type: "object", properties: { nodeId: { type: "string" } } } },
];
const selectionText = `Selected in Figma (live): Welcome  #1:1  360×780

Code Connect:  Button  →  src/ui/Button.tsx  <Button variant="primary">
Variables:     brand/primary = #2563eb   space/md = 16

export function Welcome() {
  return (
    <main className="flex h-[780px] w-[360px] flex-col justify-between p-6">
      <img src={heroIllustration} className="h-80 w-full rounded-[28px] object-cover" />
      <Copy title="Plan trips together" />
      <Button variant="primary">Get started</Button>
    </main>
  );
}`;

Bun.serve({
	port,
	hostname: "127.0.0.1",
	async fetch(req) {
		const u = new URL(req.url);
		const p = u.pathname;
		if (p === "/mcp") {
			if (req.method !== "POST") return new Response("", { status: 405 });
			const b: any = await req.json();
			if (b.id === undefined) return new Response(null, { status: 202 });
			const result =
				b.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "Figma Dev Mode MCP Server", version: "1.0.0" } } :
				b.method === "tools/list" ? { tools } :
				b.params?.name === "get_screenshot" ? { content: [{ type: "text", text: "(screenshot of Welcome, 360×780)" }] } :
				{ content: [{ type: "text", text: selectionText }] };
			return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result }), { headers: { "content-type": "application/json", "mcp-session-id": "demo" } });
		}
		if (p.startsWith("/img/")) return new Response(png, { headers: { "content-type": "image/png" } });
		if (p === "/v1/me") return json({ id: "1", handle: "Mia Hansen", email: "mia@acme.example" });
		if (p === "/v1/teams/1001/projects") return json({ name: "Acme", projects: [{ id: "p1", name: "Mobile app" }, { id: "p2", name: "Marketing site" }] });
		if (p === "/v1/projects/p1/files") return json({ files: [{ key: KEY, name: "Acme Mobile", last_modified: "2026-10-12T09:30:00Z" }, { key: "Pr0t0typ3Key", name: "Checkout prototype", last_modified: "2026-09-30T12:00:00Z" }] });
		if (p === "/v1/projects/p2/files") return json({ files: [{ key: "WebS1teKey001", name: "Landing page", last_modified: "2026-08-02T08:00:00Z" }] });
		const m = /^\/v1\/files\/([^/]+)(\/.*)?$/.exec(p);
		if (m && m[1] === KEY) {
			const sub = m[2] ?? "";
			if (sub === "") {
				const depth = Number(u.searchParams.get("depth") ?? 99);
				const cut = (n: any, d: number): any => ({ ...n, children: d >= depth ? undefined : n.children?.map((c: any) => cut(c, d + 1)) });
				return json({ name: "Acme Mobile", lastModified: "2026-10-12T09:30:00Z", version: "42", components: {}, styles: {}, document: cut(doc, 0) });
			}
			if (sub === "/nodes") {
				const ids = (u.searchParams.get("ids") ?? "").split(",");
				return json({ nodes: Object.fromEntries(ids.map((id) => [id, index.has(id) ? { document: index.get(id), components: { "9:1": { name: "Button" } }, styles: { "S:1": { name: "Brand/Primary" } } } : null])) });
			}
			if (sub === "/variables/local") return json(variables);
			if (sub === "/meta") return json({ file: { name: "Acme Mobile", folder_name: "Mobile app", creator: { handle: "Mia Hansen" }, last_touched_by: { handle: "Jon" }, last_touched_at: "2026-10-12T09:30:00Z", editorType: "figma", link_access: "org_view" } });
			if (sub === "/comments") return json({ comments: [
				{ id: "c1", user: { handle: "Jon" }, message: "Can the hero be taller on small phones?", client_meta: { node_id: "1:2" }, resolved_at: null },
				{ id: "c2", parent_id: "c1", user: { handle: "Mia Hansen" }, message: "Yes, 360px minimum." },
			] });
			if (sub === "/components") return json({ meta: { components: [{ node_id: "9:1", key: "k1", name: "Button", description: "Primary action", containing_frame: { name: "Components" } }] } });
			if (sub === "/styles") return json({ meta: { styles: [{ node_id: "1:7", style_type: "FILL", name: "Brand/Primary" }] } });
		}
		if (p.startsWith("/v1/images/")) return json({ images: Object.fromEntries((u.searchParams.get("ids") ?? "").split(",").map((id) => [id, `http://127.0.0.1:${port}/img/${id}.png`])) });
		return json({ err: "not found", status: 404 }, 404);
	},
});
console.error(`mock-figma listening on http://127.0.0.1:${port}`);
