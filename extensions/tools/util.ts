import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { FigmaClient } from "../core/api.ts";
import { type FigmaRef, normalizeIds, parseFigmaRef } from "../core/url.ts";

export const MAX_OUT = 60_000;

export const FILE = Type.String({ description: "Figma file URL (preferred; its node-id is used when no node ids are given) or file key" });
export const NODE_IDS = Type.Optional(Type.Array(Type.String(), { description: 'Node ids like "1:2" (or "1-2"). Defaults to the node-id in the URL.' }));

export interface Ctx {
	client: FigmaClient;
}

export const text = (t: string, details: unknown = {}) => ({ content: [{ type: "text" as const, text: clip(t) }], details });

export function clip(s: string, max = MAX_OUT): string {
	return s.length <= max ? s : `${s.slice(0, max)}\n…[output truncated at ${max} chars: lower depth/max_nodes or request a smaller node]`;
}

/** Resolve a file arg + optional node ids (falling back to the URL's node-id). */
export function target(file: string, nodeIds?: readonly string[]): { ref: FigmaRef; ids: string[] } {
	const ref = parseFigmaRef(file);
	const ids = normalizeIds(nodeIds);
	if (!ids.length && ref.nodeId) ids.push(ref.nodeId);
	return { ref, ids };
}

export const nodeUrl = (key: string, id: string) => `https://www.figma.com/design/${key}?node-id=${id.replace(/:/g, "-")}`;

export interface NodesResult {
	docs: Record<string, any>[];
	components: Record<string, any>;
	styles: Record<string, any>;
	missing: string[];
}

export async function fetchNodes(client: FigmaClient, key: string, ids: string[], depth?: number): Promise<NodesResult> {
	const r = await client.get(`/v1/files/${key}/nodes`, { ids: ids.join(","), depth, geometry: undefined });
	const out: NodesResult = { docs: [], components: {}, styles: {}, missing: [] };
	for (const id of ids) {
		const n = r.nodes?.[id];
		if (!n?.document) out.missing.push(id);
		else {
			out.docs.push(n.document);
			Object.assign(out.components, n.components);
			Object.assign(out.styles, n.styles);
		}
	}
	return out;
}

export function resolveDir(cwd: string, dir: string | undefined, fallback: string): string {
	const d = dir ?? fallback;
	return isAbsolute(d) ? d : resolve(cwd, d);
}

export async function saveBytes(dir: string, file: string, bytes: Uint8Array): Promise<string> {
	await mkdir(dir, { recursive: true });
	const p = join(dir, file);
	await writeFile(p, bytes);
	return p;
}

export const safeName = (s: string) => s.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "") || "asset";
