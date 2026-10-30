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

describe("retries (arrow-resilience-kit)", () => {
	const flaky = (failures: (() => Response | Promise<Response>)[]) => {
		let n = 0;
		const calls: string[] = [];
		const fn = async (url: string, init?: RequestInit) => {
			calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
			const f = failures[n++];
			return f ? f() : Response.json({ ok: n });
		};
		return { fn, calls };
	};
	const client = (fn: any, o: object = {}) => new FigmaClient({ getToken: () => "t", fetch: fn, cacheMs: 0, retryBaseMs: 1, ...o });

	test("GETs retry transient 502/503/504 and network errors, then succeed", async () => {
		const f = flaky([() => new Response("", { status: 503 }), () => Promise.reject(new TypeError("fetch failed")), () => new Response("", { status: 502 })]);
		expect(await client(f.fn, { retries: 3 }).get("/v1/me")).toEqual({ ok: 4 });
		expect(f.calls).toHaveLength(4);
	});

	test("GETs give up after `retries` and report the last error", async () => {
		const f = flaky(Array(5).fill(() => new Response("{}", { status: 504 })));
		await expect(client(f.fn).get("/v1/me")).rejects.toMatchObject({ status: 504 });
		expect(f.calls).toHaveLength(3); // 1 + default 2 retries
	});

	test("client errors and POST failures are not retried (not idempotent), 429 is", async () => {
		const notFound = flaky([() => new Response("{}", { status: 404 })]);
		await expect(client(notFound.fn).get("/v1/files/x")).rejects.toMatchObject({ status: 404 });
		expect(notFound.calls).toHaveLength(1);
		const post = flaky([() => new Response("", { status: 503 })]);
		await expect(client(post.fn).post("/v1/x", {})).rejects.toMatchObject({ status: 503 });
		const net = flaky([() => Promise.reject(new TypeError("fetch failed"))]);
		await expect(client(net.fn).post("/v1/x", {})).rejects.toThrow("fetch failed");
		expect(post.calls.length + net.calls.length).toBe(2);
		const limited = flaky([() => new Response("{}", { status: 429, headers: { "retry-after": "0" } })]);
		expect(await client(limited.fn).post("/v1/x", {})).toEqual({ ok: 2 });
	});

	test("aborting the tool call cancels a POST's pending retry wait", async () => {
		const f = flaky([() => new Response("{}", { status: 429, headers: { "retry-after": "5" } })]);
		const ac = new AbortController();
		const t0 = Date.now();
		setTimeout(() => ac.abort(), 30);
		const r = callSignal.run(ac.signal, () => client(f.fn).post("/v1/x", {}));
		await expect(r).rejects.toMatchObject({ name: "AbortError" });
		expect(Date.now() - t0).toBeLessThan(1_000);
		expect(f.calls).toHaveLength(1);
	});

	test("aborting cancels an in-flight POST inside the retry loop (signal survives the kit)", async () => {
		const hang = (_u: string, init?: RequestInit) =>
			new Promise<Response>((_r, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
		const ac = new AbortController();
		const t0 = Date.now();
		setTimeout(() => ac.abort(new DOMException("esc", "AbortError")), 20);
		await expect(callSignal.run(ac.signal, () => client(hang).post("/v1/x", {}))).rejects.toMatchObject({ name: "AbortError" });
		expect(Date.now() - t0).toBeLessThan(1_000);
	});

	test("concurrent calls keep their own abort signal: Esc on one doesn't cancel the other", async () => {
		const fn = (_u: string, init?: RequestInit) =>
			new Promise<Response>((resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
				setTimeout(() => resolve(Response.json({ done: true })), 40);
			});
		const a = new AbortController();
		const b = new AbortController();
		const c = client(fn);
		const pa = callSignal.run(a.signal, () => c.post("/v1/a", {}));
		const pb = callSignal.run(b.signal, () => c.post("/v1/b", {}));
		a.abort(new DOMException("esc", "AbortError"));
		await expect(pa).rejects.toMatchObject({ name: "AbortError" });
		expect(await pb).toEqual({ done: true });
	});

	test("the kit stays silent: nothing reaches the console", async () => {
		const spy = [console.log, console.warn, console.error, console.info, console.debug];
		const out: unknown[] = [];
		console.log = console.warn = console.error = console.info = console.debug = (...a: unknown[]) => out.push(a);
		try {
			const f = flaky(Array(3).fill(() => new Response("", { status: 503 })));
			await client(f.fn).get("/v1/me").catch(() => {});
		} finally {
			[console.log, console.warn, console.error, console.info, console.debug] = spy as [any, any, any, any, any];
		}
		expect(out).toEqual([]);
	});
});
