import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { FigmaClient } from "../core/api.ts";
import type { McpClient } from "../core/mcp.ts";
import { type FigmaRef, normalizeIds, parseFigmaRef } from "../core/url.ts";

export const MAX_OUT = 60_000;

// Shared params: repeated in ~25 tool schemas, so keep them short. The URL node-id default is explained once in GUIDELINES.
export const FILE = Type.String({ description: "Figma URL or file key" });
export const NODE_IDS = Type.Optional(Type.Array(Type.String(), { description: 'e.g. "1:2"; default: URL node-id' }));

export interface Ctx {
	client: FigmaClient;
	mcp: McpClient;
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

/** Map with at most `limit` calls in flight; results keep the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]!, i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

export const chunks = <T>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** File extension for a downloaded image's content type. */
export const imageExt = (mime: string, fallback = "png"): string =>
	({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" })[mime.split(";")[0]!.trim().toLowerCase()] ?? fallback;
