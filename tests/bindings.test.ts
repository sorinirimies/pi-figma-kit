/** Token bindings: bound variables and named styles become var(--token, literal) in CSS output. */
import { expect, test } from "bun:test";
import { FigmaClient } from "../extensions/core/api.ts";
import { bindTokens, hasBoundVariables, varNames } from "../extensions/design/bindings.ts";
import { generate } from "../extensions/design/codegen.ts";
import { generateCompose } from "../extensions/design/compose.ts";
import { nodeCss, textCss } from "../extensions/design/css.ts";
import { outline, simplify } from "../extensions/design/simplify.ts";
import { readTools } from "../extensions/tools/read.ts";

const alias = (id: string) => ({ type: "VARIABLE_ALIAS", id });
const NAMES: Record<string, string> = { v1: "spacing/md", v2: "brand/primary", v3: "radius/lg", v4: "type/body-size", v5: "space/xs", v6: "line/stroke", v7: "fx/fade", v8: "type/weight" };
const names = (id: string) => NAMES[id];

const frame = {
	id: "1:1", name: "Card", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 16, cornerRadius: 12,
	paddingTop: 8, paddingRight: 24, paddingBottom: 8, paddingLeft: 24, opacity: 0.5,
	absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
	fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, boundVariables: { color: alias("v2") } }],
	strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, boundVariables: { color: alias("v6") } }], strokeWeight: 1,
	boundVariables: {
		itemSpacing: alias("v1"), paddingTop: alias("v5"), paddingBottom: alias("v5"), opacity: alias("v7"),
		topLeftRadius: alias("v3"), topRightRadius: alias("v3"), bottomRightRadius: alias("v3"), bottomLeftRadius: alias("v3"),
		width: alias("nope"),
	},
	children: [
		{ id: "1:2", name: "Body", type: "TEXT", characters: "Hi", style: { fontSize: 14, fontWeight: 500, fontFamily: "Inter" },
			fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }], styles: { fill: "S:1" },
			boundVariables: { fontSize: [alias("v4"), alias("v4")], fontWeight: [alias("v8"), alias("other")] } },
	],
};

test("bound variables -> var(--name, literal), per side, matching export_tokens names", () => {
	const v = bindTokens(frame, nodeCss(frame), { names });
	expect(v).toEqual({
		gap: "var(--spacing-md, 16px)",
		padding: "var(--space-xs, 8px) 24px",
		"border-radius": "var(--radius-lg, 12px)",
		background: "var(--brand-primary, #ff0000)",
		border: "1px solid var(--line-stroke, #000000)",
		opacity: "var(--fx-fade, 0.5)",
	}); // width: unknown variable id -> stays literal
	expect(bindTokens(frame, nodeCss(frame), {})).toEqual({}); // no names, no styles
});

test("text: same variable over all ranges binds, mixed ranges don't; fill style fallback", () => {
	const t = frame.children[0]!;
	const css = { ...nodeCss(t, { parent: frame }), ...textCss(t.style, t.fills) };
	expect(bindTokens(t, css, { names, styles: { "S:1": { name: "Text/Muted" } } })).toEqual({
		"font-size": "var(--type-body-size, 14px)",
		color: "var(--text-muted, #0000ff)",
	});
});

test("partial radius, outline strokes, individual sides, gradients and circles are left alone", () => {
	const n = { id: "x", type: "RECTANGLE", rectangleCornerRadii: [4, 4, 0, 0], boundVariables: { topLeftRadius: alias("v3") },
		strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], strokeWeight: 2, strokeAlign: "OUTSIDE", styles: { strokes: "S:2" },
		fills: [{ type: "GRADIENT_LINEAR", gradientStops: [], boundVariables: { color: alias("v2") } }], absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 1 } };
	expect(bindTokens(n, nodeCss(n), { names, styles: { "S:2": { name: "Line" } } })).toEqual({
		"border-radius": "var(--radius-lg, 4px) 4px 0px 0px",
		outline: "2px solid var(--line, #000000)",
	});
	const circle = { id: "c", type: "ELLIPSE", boundVariables: { topLeftRadius: alias("v3") }, absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 1 } };
	expect(bindTokens(circle, nodeCss(circle), { names })).toEqual({});
	const pad = { id: "p", type: "FRAME", layoutMode: "HORIZONTAL", paddingTop: 4, paddingRight: 4, paddingBottom: 4, paddingLeft: 4, boundVariables: { paddingTop: alias("v5"), paddingRight: alias("v5"), paddingBottom: alias("v5"), paddingLeft: alias("v5") } };
	expect(bindTokens(pad, nodeCss(pad), { names }).padding).toBe("var(--space-xs, 4px)");
	const fourSides = { ...pad, paddingLeft: 2, boundVariables: { paddingTop: alias("v5") } };
	expect(bindTokens(fourSides, nodeCss(fourSides), { names }).padding).toBe("var(--space-xs, 4px) 4px 4px 2px");
});

test("detection and helpers", () => {
	expect(hasBoundVariables(frame)).toBe(true);
	expect(hasBoundVariables({ fills: [{ boundVariables: { color: alias("a") } }] })).toBe(true);
	expect(hasBoundVariables({ type: "FRAME", children: [{ type: "TEXT" }], fills: [{}] })).toBe(false);
	expect(varNames({ a: "var(--x, 1px) var(--y, 2px)", b: "var(--x, 3px)", c: "red" })).toEqual(["--x", "--y"]);
	expect(varNames(undefined)).toEqual([]);
});

test("outline and codegen use the tokens; compose keeps literals and names the tokens", () => {
	const tree = simplify(frame, { varNames: names, styles: { "S:1": { name: "Text/Muted" } } });
	expect(tree.css.gap).toBe("16px"); // raw css untouched
	expect(outline(tree)).toContain("gap: var(--spacing-md, 16px)");
	const react = generate(tree, { framework: "react" });
	expect(react.css).toContain("gap: var(--spacing-md, 16px);");
	expect(react.css).toContain("color: var(--text-muted, #0000ff);");
	expect(generate(tree, { framework: "tailwind" }).code).toContain("[gap:var(--spacing-md,_16px)]");
	const k = generateCompose(tree).code;
	expect(k).toContain("// tokens: --spacing-md, --fx-fade, --space-xs, --radius-lg, --brand-primary, --line-stroke");
	expect(k).toContain("Arrangement.spacedBy(16.dp)");
	expect(k).toContain("// tokens: --type-body-size, --text-muted");
	const icon = simplify({ id: "i", name: "Ico", type: "VECTOR", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, boundVariables: { color: alias("v2") } }] }, { varNames: names });
	expect(icon.vars).toEqual({ background: "var(--brand-primary, #000000)" });
});

function tools(variables: "ok" | 403 | 500) {
	const seen: string[] = [];
	const fetch = async (u: string) => {
		const url = new URL(u);
		seen.push(url.pathname);
		if (url.pathname.endsWith("/variables/local")) {
			if (variables === "ok") return Response.json({ meta: { variables: Object.fromEntries(Object.entries(NAMES).map(([id, name]) => [id, { name }])) } });
			return new Response("{}", { status: variables });
		}
		const ids = url.searchParams.get("ids")!.split(",");
		return Response.json({ nodes: Object.fromEntries(ids.map((id) => [id, { document: id === "2:2" ? { id, name: "Plain", type: "FRAME" } : frame, styles: {} }])) });
	};
	const client = new FigmaClient({ getToken: () => "t", fetch, cacheMs: 0 });
	const [, context, code] = readTools({ client, mcp: {} as any });
	const run = async (t: any, p: any) => (await t.execute("id", { file: "AbC123xyz90", ...p })).content[0].text as string;
	return { context, code, run, seen };
}

test("tools: variable names are fetched when something is bound", async () => {
	const t = tools("ok");
	expect(await t.run(t.context, { node_ids: ["1:1"] })).toContain("gap: var(--spacing-md, 16px)");
	const out = await t.run(t.code, { node_id: "1:1", framework: "html" });
	expect(out).toContain("background: var(--brand-primary, #ff0000);");
	expect(out).toContain("define them with figma_export_tokens");
	expect(await t.run(t.code, { node_id: "1:1", framework: "compose" })).toContain("// tokens: --spacing-md");
	const before = t.seen.filter((p) => p.endsWith("/variables/local")).length;
	const plain = await t.run(t.code, { node_id: "2:2" });
	expect(plain).not.toContain("figma_export_tokens");
	expect(t.seen.filter((p) => p.endsWith("/variables/local")).length).toBe(before); // nothing bound -> no fetch
});

test("tools: without Enterprise access, a note and one request per file", async () => {
	const t = tools(403);
	const a = await t.run(t.context, { node_ids: ["1:1"] });
	expect(a).toContain("gap: 16px");
	expect(a).toContain("need file_variables:read");
	expect(await t.run(t.code, { node_id: "1:1", framework: "compose" })).toContain("need file_variables:read");
	expect(t.seen.filter((p) => p.endsWith("/variables/local"))).toHaveLength(1);
	const broken = tools(500);
	await expect(broken.run(broken.context, { node_ids: ["1:1"] })).rejects.toThrow(/500/);
});
