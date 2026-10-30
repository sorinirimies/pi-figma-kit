/** Client robustness: LRU cache cap, shared in-flight GETs, cancellation via the call signal, timeouts. */
import { describe, expect, test } from "bun:test";
import { FigmaClient, callSignal } from "../extensions/core/api.ts";
import { McpClient } from "../extensions/core/mcp.ts";

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

/** fetch that never answers until its signal aborts. */
const hanging = (u: string, init?: RequestInit) =>
	new Promise<Response>((_res, rej) => {
		const s = init?.signal;
		s?.addEventListener("abort", () => rej(s.reason), { once: true });
	});

describe("cache", () => {
	test("evicts least recently used entries over the byte cap", async () => {
		const calls: string[] = [];
		const fetch = async (u: string) => (calls.push(new URL(u).pathname), json({ pad: "x".repeat(80) }));
		const c = new FigmaClient({ getToken: () => "t", fetch, cacheBytes: 250 });
		await c.get("/a");
		await c.get("/b");
		await c.get("/a"); // hit: /a becomes most recent
		await c.get("/c"); // over the cap: evicts /b
		expect(c.cachedBytes).toBeLessThanOrEqual(250);
		await c.get("/a");
		await c.get("/b");
		expect(calls).toEqual(["/a", "/b", "/c", "/b"]);
	});

	test("does not cache a response larger than the cap; expired entries refetch", async () => {
		let n = 0;
		const c = new FigmaClient({ getToken: () => "t", fetch: async () => (n++, json({ pad: "x".repeat(500) })), cacheBytes: 100 });
		await c.get("/big");
		await c.get("/big");
		expect(n).toBe(2);
		expect(c.cachedBytes).toBe(0);
		let now = 0;
		const real = Date.now;
		Date.now = () => now;
		try {
			const d = new FigmaClient({ getToken: () => "t", fetch: async () => (n++, json({})), cacheMs: 10 });
			await d.get("/x");
			await d.get("/x");
			now = 20;
			await d.get("/x");
			expect(n).toBe(4);
			expect(d.cachedBytes).toBe(2);
		} finally {
			Date.now = real;
		}
	});

	test("identical concurrent GETs share one request", async () => {
		let n = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const c = new FigmaClient({ getToken: () => "t", fetch: async () => (n++, await gate, json({ ok: 1 })), cacheMs: 0 });
		const all = Promise.all([c.get("/f"), c.get("/f"), c.get("/f")]);
		release();
		expect(await all).toEqual([{ ok: 1 }, { ok: 1 }, { ok: 1 }]);
		expect(n).toBe(1);
		await c.get("/f"); // cacheMs 0: nothing cached, a new request
		expect(n).toBe(2);
	});
});

describe("cancellation", () => {
	test("aborting the call rejects its GET; another caller sharing it still gets the result", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const c = new FigmaClient({ getToken: () => "t", fetch: async () => (await gate, json({ v: 1 })) });
		const ac = new AbortController();
		const aborted = callSignal.run(ac.signal, () => c.get("/s"));
		const other = c.get("/s");
		ac.abort(new Error("stop"));
		await expect(aborted).rejects.toThrow("stop");
		release();
		expect(await other).toEqual({ v: 1 });
		// already aborted before the call
		await expect(callSignal.run(ac.signal, () => c.get("/s2"))).rejects.toThrow("stop");
	});

	test("POST and download use the call signal", async () => {
		const c = new FigmaClient({ getToken: () => "t", fetch: hanging });
		const ac = new AbortController();
		const post = callSignal.run(ac.signal, () => c.post("/p", { a: 1 }));
		const dl = callSignal.run(ac.signal, () => c.download("https://img.test/x.png"));
		ac.abort(new Error("esc"));
		const [a, b] = await Promise.allSettled([post, dl]);
		expect(a).toMatchObject({ status: "rejected", reason: new Error("esc") });
		expect(b).toMatchObject({ status: "rejected", reason: new Error("esc") });
	});

	test("timeouts become friendly errors", async () => {
		const c = new FigmaClient({ getToken: () => "t", fetch: hanging, timeoutMs: 5, downloadTimeoutMs: 5 });
		await expect(c.get("/slow")).rejects.toThrow(/timed out after 0.005s/);
		await expect(c.post("/slow", {})).rejects.toThrow(/timed out/);
		await expect(c.download("https://img.test/slow")).rejects.toThrow(/Download timed out/);
		const e = await c.get("/slow2").catch((x) => x);
		expect(e.status).toBe(408);
		const boom = new FigmaClient({ getToken: () => "t", fetch: async () => Promise.reject(new Error("net down")) });
		await expect(boom.get("/x")).rejects.toThrow("net down");
		await expect(boom.download("https://img.test/x")).rejects.toThrow("net down");
	});

	test("MCP calls abort with the call signal instead of reporting 'not reachable'", async () => {
		const m = new McpClient({ url: () => "http://127.0.0.1:1/mcp", fetch: hanging as any });
		const ac = new AbortController();
		const p = callSignal.run(ac.signal, () => m.listTools());
		const err = new Error("esc");
		err.name = "AbortError";
		ac.abort(err);
		await expect(p).rejects.toThrow("esc");
		const t = new McpClient({ url: () => "http://127.0.0.1:1/mcp", fetch: hanging as any, timeoutMs: 5 });
		await expect(t.listTools()).rejects.toThrow(/not reachable/);
	});
});
