// Randomised robustness tests ("fuzzing" without extra dependencies).
//
// Figma JSON is untrusted and wildly varied: every node field is optional and files are
// edited by many people. The translators must never throw on garbage, and the URL parser
// must either return a ref or fail with a plain Error. The generator is seeded, so a failure
// prints a seed that reproduces it exactly:
//
//   FUZZ_SEED=12345 bun test tests/fuzz.test.ts --config=bunfig.fuzz.toml
//   FUZZ_ITERS=200000 bun test tests/fuzz.test.ts --config=bunfig.fuzz.toml   (just fuzz)
import { describe, expect, it } from "bun:test";
import { generate } from "../extensions/design/codegen.ts";
import { generateCompose } from "../extensions/design/compose.ts";
import { collectFlows, renderFlows } from "../extensions/design/flows.ts";
import { outline, simplify } from "../extensions/design/simplify.ts";
import { fromVariables, toCss, toJson, toTailwind } from "../extensions/design/tokens.ts";
import { McpClient, parseSse } from "../extensions/core/mcp.ts";
import { decodePng, encodePng } from "../extensions/design/png.ts";
import { diffImages } from "../extensions/design/diff.ts";
import { normalizeNodeId, parseFigmaRef } from "../extensions/core/url.ts";

const ITERS = Number(process.env.FUZZ_ITERS ?? 300);
const SEED = Number(process.env.FUZZ_SEED ?? Math.floor(Math.random() * 2 ** 31));

/** mulberry32: small, fast, seedable. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
type R = () => number;
const pick = <T>(r: R, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const chance = (r: R, p: number) => r() < p;
const num = (r: R) => pick(r, [0, 1, -1, 0.5, 1e-9, 1e9, NaN, Infinity, r() * 1000, r()]);
const str = (r: R) => pick(r, ["", "a", "Hello <World> {x}", "$5 \"q\"", "line\nbreak", "ünï/cödé 🔥", "../../etc", "x".repeat(300), "1:2", "a-b_c"]);
// Figma's JSON is well-typed but sparse: fields may be missing, null, NaN-ish or carry unknown enum values.
const junk = (r: R): unknown => pick(r, [null, undefined]);
const empty = (): unknown => ({});

const color = (r: R) => (chance(r, 0.1) ? junk(r) : { r: num(r), g: num(r), b: num(r), a: chance(r, 0.5) ? num(r) : undefined });
const paint = (r: R): unknown => {
	if (chance(r, 0.1)) return empty();
	const type = pick(r, ["SOLID", "GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND", "IMAGE", "VIDEO", "BOGUS"]);
	return {
		type, visible: chance(r, 0.8) ? undefined : false, opacity: chance(r, 0.5) ? num(r) : undefined, color: color(r), imageRef: str(r), scaleMode: pick(r, ["FILL", "FIT", "TILE", "STRETCH", "x"]),
		gradientHandlePositions: chance(r, 0.7) ? [{ x: num(r), y: num(r) }, { x: num(r), y: num(r) }, { x: num(r), y: num(r) }] : junk(r),
		gradientStops: chance(r, 0.7) ? Array.from({ length: Math.floor(r() * 4) }, () => ({ position: num(r), color: color(r) })) : junk(r),
	};
};
const effect = (r: R): unknown => (chance(r, 0.1) ? empty() : { type: pick(r, ["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR", "X"]), radius: num(r), spread: num(r), offset: chance(r, 0.8) ? { x: num(r), y: num(r) } : junk(r), color: color(r), visible: chance(r, 0.9) ? undefined : false });

function node(r: R, depth: number): Record<string, unknown> {
	const type = pick(r, ["FRAME", "GROUP", "TEXT", "RECTANGLE", "ELLIPSE", "VECTOR", "INSTANCE", "COMPONENT", "COMPONENT_SET", "LINE", "STAR", "BOOLEAN_OPERATION", "SECTION", "CANVAS", "DOCUMENT", "WEIRD"]);
	const n: Record<string, unknown> = { id: `${Math.floor(r() * 9)}:${Math.floor(r() * 99)}`, name: str(r), type };
	const maybe = (k: string, v: unknown, p = 0.5) => { if (chance(r, p)) n[k] = v; };
	maybe("visible", pick(r, [true, false, junk(r)]), 0.2);
	maybe("opacity", num(r), 0.2);
	maybe("rotation", num(r), 0.2);
	maybe("blendMode", pick(r, ["NORMAL", "MULTIPLY", "PASS_THROUGH", "X", junk(r)]), 0.2);
	maybe("layoutMode", pick(r, ["NONE", "HORIZONTAL", "VERTICAL", "GRID", junk(r)]));
	maybe("layoutWrap", pick(r, ["WRAP", "NO_WRAP", junk(r)]), 0.2);
	for (const k of ["itemSpacing", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "cornerRadius", "strokeWeight", "counterAxisSpacing"]) maybe(k, num(r), 0.3);
	maybe("rectangleCornerRadii", chance(r, 0.7) ? [num(r), num(r), num(r), num(r)] : junk(r), 0.2);
	for (const k of ["primaryAxisAlignItems", "counterAxisAlignItems", "layoutSizingHorizontal", "layoutSizingVertical", "layoutAlign", "strokeAlign", "textAutoResize"]) maybe(k, pick(r, ["MIN", "MAX", "CENTER", "SPACE_BETWEEN", "FILL", "HUG", "FIXED", "STRETCH", "INSIDE", "OUTSIDE", "X", junk(r)]), 0.3);
	maybe("clipsContent", junk(r), 0.2);
	maybe("layoutGrow", num(r), 0.2);
	maybe("absoluteBoundingBox", chance(r, 0.8) ? { x: num(r), y: num(r), width: num(r), height: num(r) } : junk(r), 0.8);
	maybe("fills", chance(r, 0.8) ? Array.from({ length: Math.floor(r() * 3) }, () => paint(r)) : junk(r));
	maybe("strokes", chance(r, 0.8) ? Array.from({ length: Math.floor(r() * 2) }, () => paint(r)) : junk(r), 0.3);
	maybe("effects", chance(r, 0.8) ? Array.from({ length: Math.floor(r() * 3) }, () => effect(r)) : junk(r), 0.3);
	maybe("strokeDashes", chance(r, 0.5) ? [num(r)] : junk(r), 0.1);
	maybe("individualStrokeWeights", chance(r, 0.5) ? { top: num(r), right: num(r), bottom: num(r), left: num(r) } : junk(r), 0.1);
	maybe("componentId", str(r), 0.2);
	maybe("styles", chance(r, 0.7) ? { fill: str(r), text: str(r) } : junk(r), 0.2);
	maybe("interactions", chance(r, 0.6) ? [{ trigger: junk(r), actions: [{ type: pick(r, ["NODE", "URL", "BACK", "CLOSE", "X"]), destinationId: str(r), url: str(r), navigation: str(r) }, empty()] }, empty()] : junk(r), 0.2);
	maybe("transitionNodeID", str(r), 0.1);
	maybe("flowStartingPoints", chance(r, 0.6) ? [{ nodeId: str(r), name: str(r) }] : junk(r), 0.1);
	if (type === "TEXT" || chance(r, 0.1)) {
		const text = str(r);
		n.characters = chance(r, 0.9) ? text : junk(r);
		maybe("style", chance(r, 0.8) ? { fontFamily: str(r), fontSize: num(r), fontWeight: num(r), italic: junk(r), lineHeightPx: num(r), letterSpacing: num(r), textAlignHorizontal: pick(r, ["LEFT", "CENTER", "RIGHT", "JUSTIFIED", "x"]), textCase: pick(r, ["UPPER", "LOWER", "TITLE", "x"]), textDecoration: pick(r, ["UNDERLINE", "STRIKETHROUGH", "NONE", "x"]) } : junk(r), 0.9);
		maybe("characterStyleOverrides", chance(r, 0.7) ? Array.from({ length: Math.floor(r() * 20) }, () => pick(r, [0, 1, 2, 99, -1, null])) : junk(r), 0.4);
		maybe("styleOverrideTable", chance(r, 0.7) ? { "1": { fontWeight: num(r), fills: [paint(r)] }, "2": empty() } : junk(r), 0.4);
	}
	if (depth > 0 && chance(r, 0.7)) n.children = Array.from({ length: Math.floor(r() * 4) }, () => node(r, depth - 1));
	else if (chance(r, 0.05)) n.children = junk(r);
	return n;
}

function variables(r: R) {
	const ids = Array.from({ length: Math.floor(r() * 6) }, (_, i) => `v${i}`);
	const value = (): unknown => pick(r, [color(r), num(r), str(r), true, { type: "VARIABLE_ALIAS", id: pick(r, [...ids, "ghost"]) }, junk(r)]);
	return {
		variableCollections: { c1: { name: str(r), modes: [{ modeId: "m1", name: str(r) }, { modeId: "m2", name: str(r) }], variableIds: [...ids, "ghost"] } },
		variables: Object.fromEntries(ids.map((id) => [id, { name: str(r), resolvedType: pick(r, ["COLOR", "FLOAT", "STRING", "BOOLEAN", "X"]), remote: chance(r, 0.1), valuesByMode: { m1: value(), m2: value() } }])),
	};
}

/** Run `fn` ITERS times; on failure print the seed and iteration so it can be replayed. */
function fuzz(name: string, fn: (r: R, i: number) => void | Promise<void>) {
	it(name, async () => {
		const r = rng(SEED);
		for (let i = 0; i < ITERS; i++) {
			try {
				await fn(r, i);
			} catch (e) {
				throw new Error(`fuzz failure (FUZZ_SEED=${SEED}, iteration ${i}): ${(e as Error).stack ?? e}`);
			}
		}
	});
}

describe(`fuzz (seed ${SEED}, ${ITERS} iterations)`, () => {
	fuzz("design translators never throw and always return strings", (r) => {
		const tree = simplify(node(r, 4) as any, { components: chance(r, 0.5) ? { [str(r)]: { name: str(r) } } : undefined, styles: chance(r, 0.5) ? { [str(r)]: { name: str(r) } } : undefined, depth: Math.floor(r() * 6), maxNodes: 1 + Math.floor(r() * 50) } as any);
		expect(typeof outline(tree)).toBe("string");
		for (const framework of ["html", "react", "tailwind"] as const) {
			const out = generate(tree, { framework });
			expect(typeof out.code).toBe("string");
		}
		const k = generateCompose(tree);
		expect(k.code).toStartWith("@Composable");
	});

	fuzz("prototype flows and tokens survive garbage", (r) => {
		const f = collectFlows({ id: "0:0", name: "D", type: "DOCUMENT", children: [{ id: "0:1", name: "P", type: "CANVAS", ...(node(r, 3) as object), type2: 1 }] } as any);
		expect(typeof renderFlows(f)).toBe("string");
		const set = fromVariables(variables(r) as any, { unit: pick(r, ["px", "", "rem"]), collection: chance(r, 0.3) ? str(r) : undefined });
		expect(typeof toCss(set)).toBe("string");
		expect(() => JSON.parse(toJson(set))).not.toThrow();
		expect(typeof toTailwind(set)).toBe("string");
	});

	fuzz("PNG decoder: mutated files decode consistently or fail with a plain Error", (r) => {
		const w = 1 + Math.floor(r() * 6);
		const h = 1 + Math.floor(r() * 6);
		const img = { width: w, height: h, data: Uint8Array.from({ length: w * h * 4 }, () => Math.floor(r() * 256)) };
		const png = encodePng(img);
		expect(decodePng(png)).toEqual(img);
		const bad = Uint8Array.from(png);
		for (let k = 0, n = 1 + Math.floor(r() * 4); k < n; k++) bad[8 + Math.floor(r() * (bad.length - 8))] = Math.floor(r() * 256);
		const cut = chance(r, 0.3) ? bad.subarray(0, Math.floor(r() * bad.length)) : bad;
		try {
			const out = decodePng(cut);
			expect(out.data.length).toBe(out.width * out.height * 4);
			expect(diffImages(out, img).percent).toBeGreaterThanOrEqual(0);
		} catch (e) {
			expect(e).toBeInstanceOf(Error);
		}
	});

	fuzz("URL parser returns a ref or a plain Error", (r) => {
		const host = pick(r, ["figma.com", "www.figma.com", "evil.com", "", "figma.com.evil.io"]);
		const path = pick(r, ["design", "file", "proto", "board", "make", "x", ""]);
		const key = pick(r, ["AbC123xyz90", "short", "", str(r), "a".repeat(40)]);
		const input = pick(r, [`https://${host}/${path}/${key}/Name?node-id=${pick(r, ["1-2", "1:2", "", "abc", "%00"])}`, `${path}/${key}`, key, str(r), `https://${host}/branch/${key}`, junk(r) as any]);
		try {
			const ref = parseFigmaRef(String(input));
			expect(typeof ref.key).toBe("string");
		} catch (e) {
			expect(e).toBeInstanceOf(Error);
		}
		expect(typeof normalizeNodeId(String(str(r)))).toBe("string");
	});

	fuzz("SSE parser never throws", (r) => {
		const chunks = Array.from({ length: Math.floor(r() * 5) }, () => pick(r, [`data: ${JSON.stringify({ id: Math.floor(r() * 3), result: {} })}`, "data: {broken", ": comment", "event: message", "", "data:", str(r)]));
		const out = parseSse(chunks.join(pick(r, ["\n\n", "\r\n\r\n", "\n"])), Math.floor(r() * 3));
		expect(typeof out).toBe("object");
	});

	fuzz("MCP client turns any server reply into a result or an Error", async (r) => {
		const body = pick(r, ["", "{", "[]", "null", JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: junk(r) } }), JSON.stringify({ id: 1, error: junk(r) }), str(r)]);
		const status = pick(r, [200, 200, 202, 400, 404, 500]);
		const c = new McpClient({ url: () => undefined, fetch: (async () => new Response(body, { status, headers: { "content-type": pick(r, ["application/json", "text/event-stream", ""]) } })) as any });
		await c.listTools().then(
			(t) => expect(Array.isArray(t)).toBe(true),
			(e) => expect(e).toBeInstanceOf(Error),
		);
	});
});
