import { describe, expect, test } from "bun:test";
import { callSignal } from "../extensions/core/api.ts";
import { McpClient, parseSse } from "../extensions/core/mcp.ts";
import { desktopTools } from "../extensions/tools/desktop.ts";

function server(opts: { sse?: boolean; down?: boolean; rpcError?: string } = {}) {
	const log: { method: string; session: string | null; params: any }[] = [];
	const fn = (async (_u: string, init: RequestInit) => {
		if (opts.down) throw new Error("ECONNREFUSED");
		const b = JSON.parse(init.body as string);
		log.push({ method: b.method, session: new Headers(init.headers).get("mcp-session-id"), params: b.params });
		if (b.id === undefined) return new Response(null, { status: 202 });
		let result: any = {};
		if (b.method === "tools/list") result = b.params?.cursor ? { tools: [{ name: "b" }] } : { tools: [{ name: "get_design_context", description: "d\nmore", inputSchema: { properties: { nodeId: {} }, required: ["nodeId"] } }], nextCursor: "c2" };
		if (b.method === "tools/call") result = b.params.name === "get_screenshot" ? { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] } : b.params.name === "empty" ? { content: [] } : { content: [{ type: "text", text: `ctx ${JSON.stringify(b.params.arguments)}` }] };
		const msg = opts.rpcError ? { jsonrpc: "2.0", id: b.id, error: { message: opts.rpcError } } : { jsonrpc: "2.0", id: b.id, result };
		const h: Record<string, string> = { "mcp-session-id": "S1" };
		if (opts.sse) return new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, { headers: { ...h, "content-type": "text/event-stream" } });
		return new Response(JSON.stringify(msg), { headers: { ...h, "content-type": "application/json" } });
	}) as unknown as typeof fetch;
	return { fn, log };
}

describe("McpClient", () => {
	test("handshake, session id, paging, call (json)", async () => {
		const s = server();
		const c = new McpClient({ url: () => undefined, fetch: s.fn });
		expect(c.url).toBe("http://127.0.0.1:3845/mcp");
		expect((await c.listTools()).map((t) => t.name)).toEqual(["get_design_context", "b"]);
		const r = await c.callTool("x", { a: 1 });
		expect(r.content[0]!.text).toBe('ctx {"a":1}');
		expect(s.log.map((l) => l.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/list", "tools/call"]);
		expect(s.log[2]!.session).toBe("S1");
		expect(s.log.filter((l) => l.method === "initialize").length).toBe(1);
	});
	test("sse responses", async () => {
		const c = new McpClient({ url: () => "http://x/mcp", fetch: server({ sse: true }).fn });
		expect((await c.callTool("x")).content[0]!.text).toBe("ctx {}");
		expect(parseSse("data: not json\n\ndata: {\"id\":9,\"result\":1}\n\ndata: {\"id\":2}\n\n", 5)).toEqual({ id: 2 });
		expect(parseSse(": ping\n\n", 1)).toEqual({});
	});
	test("errors: unreachable (and retries after), rpc error, http error", async () => {
		const c = new McpClient({ url: () => undefined, fetch: server({ down: true }).fn });
		await expect(c.listTools()).rejects.toThrow(/not reachable at http:\/\/127\.0\.0\.1:3845\/mcp/);
		await expect(c.callTool("x")).rejects.toThrow(/not reachable/); // reconnect attempted again
		await expect(new McpClient({ url: () => undefined, fetch: server({ rpcError: "boom" }).fn }).callTool("x")).rejects.toThrow(/boom/);
		const bad = new McpClient({ url: () => undefined, fetch: (async () => new Response("nope", { status: 404 })) as any });
		await expect(bad.callTool("x")).rejects.toThrow(/HTTP 404/);
		bad.reset();
	});
	test("session expiry resets the connection", async () => {
		let init = 0;
		let fail = false;
		const base = server().fn;
		const fn = (async (u: string, i: RequestInit) => {
			const b = JSON.parse(i.body as string);
			if (b.method === "initialize") init++;
			if (b.method === "tools/call" && fail) return new Response("gone", { status: 404 });
			return base(u, i);
		}) as unknown as typeof fetch;
		const c = new McpClient({ url: () => undefined, fetch: fn });
		await c.callTool("x");
		fail = true;
		await expect(c.callTool("x")).rejects.toThrow(/404/);
		fail = false;
		await c.callTool("x");
		expect(init).toBe(2);
	});
});

describe("desktop tools", () => {
	const mk = () => {
		const s = server();
		const mcp = new McpClient({ url: () => undefined, fetch: s.fn });
		const [list, call, selection] = desktopTools({ mcp }) as any[];
		return { list, call, selection };
	};
	test("list", async () => {
		const r = await mk().list.execute("i", {});
		expect(r.content[0].text).toContain("get_design_context: d");
		expect(r.content[0].text).toContain("required: nodeId");
	});
	test("call passes arguments; empty and image results", async () => {
		const { call } = mk();
		expect((await call.execute("i", { tool: "t", arguments: { nodeId: "1:2" } })).content[0].text).toContain('"nodeId":"1:2"');
		expect((await call.execute("i", { tool: "t" })).content[0].text).toBe("ctx {}");
		expect((await call.execute("i", { tool: "empty" })).content[0].text).toBe("(empty result)");
		expect((await call.execute("i", { tool: "get_screenshot" })).content[0]).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" });
	});
	test("selection: current vs node, hints, screenshot", async () => {
		const { selection } = mk();
		expect((await selection.execute("i", {})).content[0].text).toBe("ctx {}");
		const r = await selection.execute("i", { node_id: "1-2", language: "kotlin", framework: "compose", screenshot: true });
		expect(r.content[0].text).toBe('ctx {"nodeId":"1:2","clientLanguages":"kotlin","clientFrameworks":"compose"}');
		expect(r.content[1].type).toBe("image");
	});
});

describe("McpClient circuit breaker (arrow-resilience-kit)", () => {
	/** A server that is down until `up()` is called; counts every connection attempt. */
	function flaky(status = 200) {
		let down = true;
		let attempts = 0;
		const ok = server().fn;
		const fn = (async (u: string, init: RequestInit) => {
			attempts++;
			if (down) throw new TypeError("fetch failed (ECONNREFUSED)");
			if (status !== 200) return new Response("boom", { status });
			return ok(u, init);
		}) as unknown as typeof fetch;
		return { fn, up: () => (down = false), attempts: () => attempts };
	}

	test("fails fast after 2 unreachable calls, then probes again after the reset time", async () => {
		const s = flaky();
		const c = new McpClient({ url: () => "http://x/mcp", fetch: s.fn, breakerResetMs: 60 });
		await expect(c.listTools()).rejects.toThrow(/not reachable at http:\/\/x\/mcp \(fetch failed/);
		await expect(c.listTools()).rejects.toThrow(/not reachable/);
		expect(s.attempts()).toBe(2);
		await expect(c.listTools()).rejects.toThrow(/unreachable moments ago; not trying again for up to 0s\. Open the Figma desktop app/);
		expect(s.attempts()).toBe(2); // no request: failed fast
		s.up();
		await Bun.sleep(80);
		expect((await c.listTools()).map((t) => t.name)).toEqual(["get_design_context", "b"]); // half-open probe succeeds, closes
	});

	test("errors the server returns never open the circuit", async () => {
		const c = new McpClient({ url: () => "http://x/mcp", fetch: server({ rpcError: "bad node" }).fn });
		for (let i = 0; i < 4; i++) await expect(c.callTool("x")).rejects.toThrow("bad node");
		const http = flaky(500);
		http.up();
		const h = new McpClient({ url: () => "http://x/mcp", fetch: http.fn });
		for (let i = 0; i < 4; i++) await expect(h.listTools()).rejects.toThrow(/HTTP 500/);
		expect(http.attempts()).toBe(4); // every call still reached the server
	});

	test("aborts don't count as unreachable", async () => {
		let attempts = 0;
		const hang = ((_u: string, init: RequestInit) => {
			attempts++;
			return new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
		}) as unknown as typeof fetch;
		const c = new McpClient({ url: () => "http://x/mcp", fetch: hang });
		for (let i = 0; i < 3; i++) {
			const ac = new AbortController();
			const p = callSignal.run(ac.signal, () => c.listTools());
			setTimeout(() => ac.abort(new DOMException("esc", "AbortError")), 5);
			await expect(p).rejects.toMatchObject({ name: "AbortError" });
		}
		expect(attempts).toBe(3); // still trying: the circuit stayed closed
	});
});
