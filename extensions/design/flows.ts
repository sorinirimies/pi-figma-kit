/** Prototype flows: starting points and interaction edges between frames. */
import type { FNode } from "./css.ts";

export interface FlowEdge {
	from: { id: string; name: string };
	to: string;
	trigger: string;
	action: string;
}
export interface Flows {
	starts: { name: string; id: string; page: string }[];
	edges: FlowEdge[];
}

export function collectFlows(doc: FNode): Flows {
	const starts: Flows["starts"] = [];
	const edges: FlowEdge[] = [];
	const names = new Map<string, string>();
	const walk = (node: FNode, page: string) => {
		names.set(node.id, node.name);
		if (node.type === "CANVAS") for (const f of node.flowStartingPoints ?? []) starts.push({ name: f.name, id: f.nodeId, page: node.name });
		for (const i of node.interactions ?? []) {
			for (const a of i.actions ?? []) {
				if (a?.destinationId) edges.push({ from: { id: node.id, name: node.name }, to: a.destinationId, trigger: i.trigger?.type ?? "ON_CLICK", action: a.navigation ?? a.type ?? "NODE" });
				else if (a?.type === "URL") edges.push({ from: { id: node.id, name: node.name }, to: a.url, trigger: i.trigger?.type ?? "ON_CLICK", action: "URL" });
				else if (a?.type === "BACK" || a?.type === "CLOSE") edges.push({ from: { id: node.id, name: node.name }, to: a.type, trigger: i.trigger?.type ?? "ON_CLICK", action: a.type });
			}
		}
		if (node.transitionNodeID && !node.interactions?.length) edges.push({ from: { id: node.id, name: node.name }, to: node.transitionNodeID, trigger: "ON_CLICK", action: "NAVIGATE" });
		for (const c of node.children ?? []) walk(c, node.type === "CANVAS" ? node.name : page);
	};
	walk(doc, "");
	for (const e of edges) if (names.has(e.to)) e.to = `${names.get(e.to)} #${e.to}`;
	return { starts, edges };
}

export function renderFlows(f: Flows): string {
	const out: string[] = [];
	if (f.starts.length) out.push("## Flow starting points", ...f.starts.map((s) => `- "${s.name}" → #${s.id} (page ${s.page})`), "");
	out.push("## Interactions", ...(f.edges.length ? f.edges.map((e) => `- "${e.from.name}" #${e.from.id} —${e.trigger}/${e.action}→ ${e.to}`) : ["(none)"]));
	return out.join("\n");
}
