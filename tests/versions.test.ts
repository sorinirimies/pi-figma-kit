/** figma_diff: tree diff between versions, version resolution. */
import { expect, test } from "bun:test";
import { FigmaClient } from "../extensions/core/api.ts";
import { diffTrees } from "../extensions/design/treediff.ts";
import { browseTools } from "../extensions/tools/browse.ts";

const D = (id: string, over: any = {}): any => ({ id, name: id, type: "FRAME", css: {}, ...over });

test("diffTrees: added/removed subtrees once, renames, moves, text, component, assets, css, runs", () => {
	const before = D("root", { children: [
		D("a", { name: "Card", css: { gap: "8px", color: "red" }, children: [D("t", { type: "TEXT", text: "Hello", runs: [{ text: "Hello", css: {} }] })] }),
		D("gone", { children: [D("gone-child")] }),
		D("b", { component: "Btn/Old", imageRef: "img1" }),
		D("same"),
		D("box"),
		D("m"),
	] });
	const after = D("root", { children: [
		D("a", { name: "Card 2", css: { gap: "16px", padding: "4px" }, vars: { gap: "var(--s, 16px)" }, children: [D("t", { type: "TEXT", text: "Hello", runs: [{ text: "Hello", css: { "font-weight": "700" } }] })] }),
		D("new", { children: [D("new-child")] }),
		D("b", { component: "Btn/New", imageRef: "img2" }),
		D("same"),
		D("box", { children: [D("m", { type: "TEXT", text: "x".repeat(100) })] }),
	] });
	const d = diffTrees(before, after);
	expect([d.added, d.removed, d.changed]).toEqual([2, 2, 4]);
	const out = d.lines.join("\n");
	expect(out).toContain('+ added FRAME "root / new" #new');
	expect(out).not.toContain("new-child");
	expect(out).toContain('- removed FRAME "root / gone" #gone');
	expect(out).not.toContain("#gone-child");
	expect(out).toContain('~ FRAME "root / Card 2" #a\n    renamed "Card" → "Card 2"\n    gap: 8px → var(--s, 16px)\n    -color: red\n    +padding: 4px');
	expect(out).toContain("    text styling (runs) changed");
	expect(out).toContain("    component Btn/Old → Btn/New\n    asset/image img1 → img2");
	expect(out).toContain('    moved from root to root / box\n    text "" → "' + "x".repeat(80) + '…"');
	expect(out).not.toContain("#same");
	expect(diffTrees(before, before).lines).toEqual([]);
	const noParents = diffTrees(D("x", { component: undefined }), D("x", { asset: "svg" }));
	expect(noParents.lines).toContain("    asset/image none → svg");
});

const VERSIONS = [
	{ id: "300", created_at: "2026-10-29T10:00:00Z", label: "Release" },
	{ id: "200", created_at: "2026-10-20T08:00:00Z" },
	{ id: "100", created_at: "2026-10-01T08:00:00Z" },
];

function tool(opts: { versions?: any[]; missing?: Record<string, boolean> } = {}) {
	const seen: URL[] = [];
	const fetch = async (u: string) => {
		const url = new URL(u);
		seen.push(url);
		if (url.pathname.endsWith("/versions")) return Response.json({ versions: opts.versions ?? VERSIONS });
		const id = url.searchParams.get("ids")!;
		const v = url.searchParams.get("version") ?? "now";
		if (opts.missing?.[v]) return Response.json({ nodes: { [id]: null } });
		return Response.json({ nodes: { [id]: { document: { id, name: "Screen", type: "FRAME", children: [{ id: "9:1", name: "Title", type: "TEXT", characters: `text@${v}` }] } } } });
	};
	const t = browseTools({ client: new FigmaClient({ getToken: () => "t", fetch, cacheMs: 0 }), mcp: {} as any }).find((x) => x.name === "figma_diff")!;
	const run = async (p: any) => ((await t.execute("id", { file: "https://figma.com/design/AbC123xyz90/x?node-id=1-2", ...p }, undefined, undefined, {} as any)).content[0] as any).text as string;
	return { run, seen };
}

test("figma_diff: default is the latest version vs now", async () => {
	const t = tool();
	const out = await t.run({});
	expect(out).toStartWith('#1:2 from version 300 (2026-10-29T10:00:00Z, "Release") to now: 0 added, 0 removed, 1 changed');
	expect(out).toContain('text "text@300" → "text@now"');
	expect(t.seen.filter((u) => u.pathname.endsWith("/nodes")).map((u) => u.searchParams.get("version"))).toEqual(["300", null]);
});

test("figma_diff: version ids, dates, explicit target", async () => {
	expect(await tool().run({ from: "100", to: "200" })).toStartWith("#1:2 from version 100 to version 200:");
	expect(await tool().run({ from: "2026-10-20" })).toContain("from version 200 (2026-10-20T08:00:00Z)"); // same day counts
	expect(await tool().run({ from: "2026-10-19" })).toContain("from version 100");
	await expect(tool().run({ from: "2026-09-01" })).rejects.toThrow("No version saved on or before 2026-09-01 among the last 3.");
	await expect(tool({ versions: [] }).run({})).rejects.toThrow("no saved versions");
	expect(await tool({ versions: [{ id: 5, created_at: "2026-01-01T00:00:00Z" }] }).run({})).toContain("from version 5 (2026-01-01T00:00:00Z) to now");
});

test("figma_diff: node added, deleted, unchanged, missing id", async () => {
	expect(await tool({ missing: { "300": true } }).run({})).toContain("the node did not exist yet");
	expect(await tool({ missing: { now: true } }).run({})).toContain("the node was deleted");
	await expect(tool({ missing: { now: true, "300": true } }).run({})).rejects.toThrow("not found in either version");
	expect(await tool().run({ from: "200", to: "200" })).toEndWith("0 added, 0 removed, 0 changed. No differences.");
	await expect(tool().run({ file: "AbC123xyz90" })).rejects.toThrow(/No node id/);
	expect(await tool().run({ file: "AbC123xyz90", node_id: "3-4", from: "100" })).toStartWith("#3:4 from version 100");
});
