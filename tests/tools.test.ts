/** Tool declarations: everything here is sent to the model on every request, so keep it small and correct. */
import { expect, test } from "bun:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { toolList } from "../extensions/command/figma-command.ts";
import { GUIDELINES, NAMESPACE, allTools } from "../extensions/tools/index.ts";

const tools = allTools({ client: {} as any, mcp: {} as any });
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
const size = (t: (typeof tools)[number]) => JSON.stringify({ n: t.name, d: t.description, p: t.parameters, s: t.promptSnippet, g: t.promptGuidelines }).length;

test("all tools stay declared to the model", () => {
	expect(tools.length).toBe(34);
	for (const t of tools) expect((t as any).exposure ?? "direct").toBe("direct");
});

test("declarations stay within the prompt budget", () => {
	const total = tools.reduce((a, t) => a + size(t), 0);
	// 16.9k chars before the trim. Raise only with a reason.
	expect(total).toBeLessThan(13_500); // ~13k with 34 tools
	for (const t of tools) expect(t.description.length).toBeLessThanOrEqual(260);
});

test("shared guidance is stated once", () => {
	expect(tools.filter((t) => t.promptGuidelines?.length).map((t) => t.name)).toEqual(["figma_get_design_context"]);
	expect(byName.figma_get_design_context!.promptGuidelines).toEqual(GUIDELINES);
	expect(NAMESPACE.instructions).toBe(GUIDELINES.join("\n"));
	for (const t of tools) expect(t.namespace).toBe(NAMESPACE);
});

test("annotations mark writes, read-only everything else", () => {
	const writes = tools.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.name).sort();
	expect(writes).toEqual([
		"figma_compare", "figma_create_dev_resource", "figma_delete_comment", "figma_desktop_call", "figma_download_assets", "figma_download_image_fills",
		"figma_get_screenshot", "figma_post_comment", "figma_update_variables",
	]);
	expect(byName.figma_delete_comment!.annotations).toMatchObject({ destructiveHint: true });
	expect(byName.figma_update_variables!.annotations).toMatchObject({ destructiveHint: true });
	expect(byName.figma_post_comment!.annotations).toMatchObject({ destructiveHint: false });
	expect(byName.figma_desktop_call!.annotations).toEqual({});
});

test("enum params accept exactly the same values as before", () => {
	const ok = (name: string, args: Record<string, unknown>) => {
		try {
			validateToolArguments(byName[name] as any, { type: "toolCall", id: "1", name, arguments: { file: "k", ...args } } as any);
			return true;
		} catch {
			return false;
		}
	};
	const cases: [string, string, string[]][] = [
		["figma_get_design_context", "format", ["outline", "json"]],
		["figma_generate_code", "framework", ["html", "react", "tailwind", "compose"]],
		["figma_get_screenshot", "format", ["png", "jpg", "svg", "pdf"]],
		["figma_download_assets", "format", ["png", "jpg", "svg", "pdf"]],
		["figma_export_tokens", "format", ["css", "json", "tailwind"]],
		["figma_export_tokens", "source", ["auto", "variables", "styles"]],
		["figma_get_component", "kind", ["component", "component_set"]],
	];
	for (const [name, key, values] of cases) {
		const base = name === "figma_download_assets" ? { assets: [{ node_id: "1:2" }] } : name === "figma_get_component" ? { key: "k" } : {};
		for (const v of values) expect(ok(name, { ...base, [key]: v })).toBe(true);
		expect(ok(name, { ...base, [key]: "nope" })).toBe(false);
		expect(ok(name, base)).toBe(true);
	}
});

test("/figma tools lists every tool, read first", () => {
	const out = toolList(tools);
	expect(out).toStartWith("34 figma tools, all available to the agent.");
	for (const t of tools) expect(out).toContain(t.name);
	expect(out.indexOf("figma_get_file_structure")).toBeLessThan(out.indexOf("Write / save files"));
	expect(out.indexOf("figma_post_comment")).toBeGreaterThan(out.indexOf("Write / save files"));
	expect(toolList([])).toContain("0 figma tools");
});
