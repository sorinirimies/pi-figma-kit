import { describe, expect, test } from "bun:test";
import { collectFlows, renderFlows } from "../extensions/design/flows.ts";
import { cssVar, fromStyles, fromVariables, toCss, toJson, toTailwind } from "../extensions/design/tokens.ts";

const meta = {
	variableCollections: {
		c1: { name: "Colors", modes: [{ modeId: "m1", name: "Light" }, { modeId: "m2", name: "Dark" }], variableIds: ["a", "b", "c", "r"] },
		c2: { name: "Spacing", modes: [{ modeId: "s", name: "Default" }], variableIds: ["d", "e"] },
	},
	variables: {
		a: { name: "brand/primary", resolvedType: "COLOR", valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 }, m2: { r: 0, g: 0, b: 1, a: 1 } } },
		b: { name: "text/default", resolvedType: "COLOR", valuesByMode: { m1: { type: "VARIABLE_ALIAS", id: "a" }, m2: { type: "VARIABLE_ALIAS", id: "a" } } },
		c: { name: "label", resolvedType: "STRING", valuesByMode: { m1: "Hi", m2: "Hi" } },
		r: { name: "remote", remote: true, resolvedType: "COLOR", valuesByMode: {} },
		d: { name: "space/md", resolvedType: "FLOAT", valuesByMode: { s: 16 } },
		e: { name: "flag", resolvedType: "BOOLEAN", valuesByMode: { s: true } },
	},
};

describe("tokens", () => {
	test("cssVar", () => expect(cssVar("Brand/Primary 500")).toBe("--brand-primary-500"));
	test("variables -> css with modes and aliases", () => {
		const set = fromVariables(meta);
		expect(set.modes).toEqual(["Light", "Dark", "Default"]);
		expect(set.tokens.length).toBe(5); // remote skipped
		const css = toCss(set);
		expect(css).toContain("--brand-primary: #ff0000;");
		expect(css).toContain("--text-default: var(--brand-primary);");
		expect(css).toContain('--label: "Hi";');
		expect(css).toContain('[data-mode="Dark"] {\n  --brand-primary: #0000ff;');
		expect(css).not.toContain('[data-mode="Dark"] {\n  --text-default'); // unchanged values are not repeated
	});
	test("unit and collection filter", () => {
		const set = fromVariables(meta, { collection: "spacing", unit: "" });
		expect(set.tokens.map((t) => t.name)).toEqual(["space/md", "flag"]);
		expect(toCss(set, ".theme")).toContain("--space-md: 16;");
		expect(toCss(fromVariables(meta, { collection: "spacing" }))).toContain("16px");
	});
	test("json nests by path, tailwind references vars", () => {
		const j = JSON.parse(toJson(fromVariables(meta)));
		expect(j.brand.primary.Light).toBe("#ff0000");
		expect(j.brand.primary.$type).toBe("color");
		expect(j.text.default.Light).toBe("{brand.primary}");
		const tw = toTailwind(fromVariables(meta));
		expect(tw).toContain('"brand-primary": "var(--brand-primary)"');
		expect(tw).toContain('"space-md"');
	});
	test("styles fallback", () => {
		const set = fromStyles(
			[{ node_id: "1", style_type: "FILL", name: "Brand" }, { node_id: "2", style_type: "TEXT", name: "H1" }, { node_id: "3", style_type: "EFFECT", name: "Sh" }, { node_id: "9", style_type: "FILL", name: "gone" }],
			{ "1": { fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }] }, "2": { style: { fontSize: 12 } }, "3": { effects: [] } },
		);
		expect(set.tokens.map((t) => t.name)).toEqual(["Brand", "H1", "Sh"]);
		expect(toCss(set)).toContain("--brand: #00ff00;");
		expect(toCss({ modes: [], tokens: [] })).toBe("\n");
	});
});

describe("flows", () => {
	const doc = {
		id: "0:0", name: "Doc", type: "DOCUMENT",
		children: [{
			id: "0:1", name: "Page", type: "CANVAS", flowStartingPoints: [{ nodeId: "1:1", name: "Onboarding" }],
			children: [
				{ id: "1:1", name: "Welcome", type: "FRAME", children: [
					{ id: "1:2", name: "Next", type: "FRAME", interactions: [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", destinationId: "1:3", navigation: "NAVIGATE" }] }, { trigger: { type: "ON_CLICK" }, actions: [{ type: "URL", url: "https://x.y" }, { type: "BACK" }, { type: "SET_VARIABLE" }] }] },
					{ id: "1:4", name: "Legacy", type: "FRAME", transitionNodeID: "1:3" },
				] },
				{ id: "1:3", name: "Home", type: "FRAME" },
			],
		}],
	};
	test("collect + render", () => {
		const f = collectFlows(doc);
		expect(f.starts).toEqual([{ name: "Onboarding", id: "1:1", page: "Page" }]);
		expect(f.edges.map((e) => e.to)).toEqual(["Home #1:3", "https://x.y", "BACK", "Home #1:3"]);
		const r = renderFlows(f);
		expect(r).toContain('"Onboarding" → #1:1');
		expect(r).toContain('"Next" #1:2 —ON_CLICK/NAVIGATE→ Home #1:3');
		expect(renderFlows({ starts: [], edges: [] })).toContain("(none)");
	});
});
