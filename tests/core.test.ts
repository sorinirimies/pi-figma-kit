import { describe, expect, test } from "bun:test";
import { FigmaClient, FigmaError } from "../extensions/core/api.ts";
import { normalizeNodeId, parseFigmaRef } from "../extensions/core/url.ts";
import { mockFetch } from "./fixtures.ts";

describe("url", () => {
	test("design url with node-id", () => {
		expect(parseFigmaRef("https://www.figma.com/design/AbC123xyz90/My-File?node-id=12-34&t=x")).toEqual({ key: "AbC123xyz90", nodeId: "12:34" });
	});
	test("branch url uses the branch key", () => {
		expect(parseFigmaRef("https://figma.com/design/MainKey12345/branch/BranchKey123/File").key).toBe("BranchKey123");
	});
	test("bare key and errors", () => {
		expect(parseFigmaRef("AbC123xyz90")).toEqual({ key: "AbC123xyz90" });
		expect(() => parseFigmaRef("hi")).toThrow();
		expect(() => parseFigmaRef("https://example.com/design/x")).toThrow();
		expect(() => parseFigmaRef("https://figma.com/files/team/1")).toThrow();
	});
	test("normalizeNodeId", () => {
		expect(normalizeNodeId("1-2")).toBe("1:2");
		expect(normalizeNodeId("1:2")).toBe("1:2");
		expect(normalizeNodeId("I5-6")).toBe("I5-6");
	});
});

describe("client", () => {
	test("sends token, caches GETs", async () => {
		const m = mockFetch({ "/v1/me": () => ({ handle: "a" }) });
		const c = new FigmaClient({ getToken: () => "figd_x", fetch: m.fn });
		await c.get("/v1/me");
		await c.get("/v1/me");
		expect(m.calls.length).toBe(1);
		expect((m.calls[0]!.init!.headers as any)["X-Figma-Token"]).toBe("figd_x");
	});
	test("oauth tokens use bearer", async () => {
		const m = mockFetch({ "/v1/me": () => ({}) });
		await new FigmaClient({ getToken: () => "figu_x", fetch: m.fn }).get("/v1/me");
		expect((m.calls[0]!.init!.headers as any).Authorization).toBe("Bearer figu_x");
	});
	test("missing token", async () => {
		await expect(new FigmaClient({ getToken: () => undefined }).get("/v1/me")).rejects.toThrow(/No Figma token/);
	});
	test("friendly errors", async () => {
		const m = mockFetch({ "/v1/files/": () => new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }) });
		const e = await new FigmaClient({ getToken: () => "t", fetch: m.fn }).get("/v1/files/x").catch((x) => x);
		expect(e).toBeInstanceOf(FigmaError);
		expect(e.message).toMatch(/403.*scope.*Forbidden/);
	});
	test("retries a short 429", async () => {
		let n = 0;
		const m = mockFetch({ "/v1/me": () => (n++ ? { ok: 1 } : new Response("{}", { status: 429, headers: { "retry-after": "1" } })) });
		const c = new FigmaClient({ getToken: () => "t", fetch: m.fn, sleep: async () => {} });
		expect(await c.get("/v1/me")).toEqual({ ok: 1 });
		const long = mockFetch({ "/v1/me": () => new Response("{}", { status: 429, headers: { "retry-after": "999" } }) });
		await expect(new FigmaClient({ getToken: () => "t", fetch: long.fn }).get("/v1/me")).rejects.toThrow(/rate limit/);
	});
	test("post sends json and query is skipped for undefined", async () => {
		const m = mockFetch({ "/v1/x": () => ({}) });
		await new FigmaClient({ getToken: () => "t", fetch: m.fn }).post("/v1/x", { a: 1 }, { q: undefined, z: 1 });
		expect(m.calls[0]!.url.search).toBe("?z=1");
		expect(m.calls[0]!.init!.body).toBe('{"a":1}');
	});
});

describe("client extras", () => {
	test("default sleep on a short 429, download ok/fail, empty body", async () => {
		let n = 0;
		const m = mockFetch({ "/v1/me": () => (n++ ? { ok: 1 } : new Response("{}", { status: 429, headers: { "retry-after": "0" } })), "/v1/empty": () => new Response("", { status: 200 }), "/img": () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } }) });
		const c = new FigmaClient({ getToken: () => "t", fetch: m.fn, baseUrl: () => "https://api.example.test/" });
		expect(await c.get("/v1/me")).toEqual({ ok: 1 });
		expect(await c.request("DELETE", "/v1/empty")).toEqual({});
		expect(m.calls[0]!.url.origin).toBe("https://api.example.test");
		const d = await c.download("https://api.example.test/img");
		expect([...d.bytes]).toEqual([1, 2]);
		expect(d.mime).toBe("image/png");
		await expect(c.download("https://api.example.test/missing")).rejects.toThrow(/Download failed \(404\)/);
		c.clearCache();
	});
});
