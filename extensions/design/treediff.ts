/** What changed in a design tree between two versions: nodes added/removed/moved/renamed, text, component and CSS changes. */
import { type DNode, withVars } from "./simplify.ts";

interface Flat {
	node: DNode;
	parent?: string;
	path: string;
}

function flatten(root: DNode): Map<string, Flat> {
	const out = new Map<string, Flat>();
	const walk = (d: DNode, parent: string | undefined, path: string) => {
		const p = path ? `${path} / ${d.name}` : d.name;
		out.set(d.id, { node: d, parent, path: p });
		for (const c of d.children ?? []) walk(c, d.id, p);
	};
	walk(root, undefined, "");
	return out;
}

export interface TreeDiff {
	lines: string[];
	added: number;
	removed: number;
	changed: number;
}

const short = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** Line-oriented diff of two simplified trees of the same node, matched by node id. */
export function diffTrees(before: DNode, after: DNode): TreeDiff {
	const a = flatten(before);
	const b = flatten(after);
	const lines: string[] = [];
	let added = 0, removed = 0, changed = 0;
	const label = (f: Flat) => `${f.node.type} "${short(f.path, 120)}" #${f.node.id}`;

	for (const [id, f] of b) {
		if (a.has(id)) continue;
		added++;
		if (!f.parent || a.has(f.parent)) lines.push(`+ added ${label(f)}`); // only the top of an added subtree
	}
	for (const [id, f] of a) {
		if (b.has(id)) continue;
		removed++;
		if (!f.parent || b.has(f.parent)) lines.push(`- removed ${label(f)}`);
	}
	for (const [id, fb] of b) {
		const fa = a.get(id);
		if (!fa) continue;
		const x = fa.node;
		const y = fb.node;
		const ch: string[] = [];
		if (x.name !== y.name) ch.push(`renamed "${x.name}" → "${y.name}"`);
		if (fa.parent !== fb.parent) ch.push(`moved from ${a.get(fa.parent ?? "")?.path ?? "?"} to ${b.get(fb.parent ?? "")?.path ?? "?"}`);
		if (x.text !== y.text) ch.push(`text ${JSON.stringify(short(x.text ?? ""))} → ${JSON.stringify(short(y.text ?? ""))}`);
		if (x.component !== y.component) ch.push(`component ${x.component ?? "none"} → ${y.component ?? "none"}`);
		if (x.asset !== y.asset || x.imageRef !== y.imageRef) ch.push(`asset/image ${x.imageRef ?? x.asset ?? "none"} → ${y.imageRef ?? y.asset ?? "none"}`);
		const cx = withVars(x);
		const cy = withVars(y);
		for (const k of new Set([...Object.keys(cx), ...Object.keys(cy)])) {
			if (cx[k] === cy[k]) continue;
			ch.push(cx[k] === undefined ? `+${k}: ${short(cy[k]!)}` : cy[k] === undefined ? `-${k}: ${short(cx[k]!)}` : `${k}: ${short(cx[k]!)} → ${short(cy[k]!)}`);
		}
		if (JSON.stringify(x.runs ?? null) !== JSON.stringify(y.runs ?? null) && x.text === y.text) ch.push("text styling (runs) changed");
		if (!ch.length) continue;
		changed++;
		lines.push(`~ ${label(fb)}`, ...ch.map((c) => `    ${c}`));
	}
	return { lines, added, removed, changed };
}
