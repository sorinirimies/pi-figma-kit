/** Parse Figma URLs / bare keys into a file key + optional node id. */
export interface FigmaRef {
	/** File key (or branch key when the URL points to a branch). */
	key: string;
	/** Node id in API form ("1:2"), when the URL carries one. */
	nodeId?: string;
}

/** "1-2" (URL form) -> "1:2" (API form). Already-normal ids pass through. */
export function normalizeNodeId(id: string): string {
	const s = decodeURIComponent(id.trim());
	return /^\d+-\d+(-\d+)*$/.test(s) && !s.includes(":") ? s.replace("-", ":").replace(/-/g, ":") : s;
}

export function parseFigmaRef(input: string): FigmaRef {
	const raw = input.trim();
	if (!/^https?:\/\//i.test(raw)) {
		if (!/^[A-Za-z0-9]{10,40}$/.test(raw)) throw new Error(`Not a Figma URL or file key: "${input}"`);
		return { key: raw };
	}
	const url = new URL(raw);
	if (!/(^|\.)figma\.com$/.test(url.hostname)) throw new Error(`Not a figma.com URL: ${input}`);
	const parts = url.pathname.split("/").filter(Boolean);
	const kind = parts[0];
	if (!["file", "design", "board", "make", "proto", "slides", "buzz"].includes(kind ?? "") || !parts[1]) {
		throw new Error(`Unsupported Figma URL (expected /design/<key>/...): ${input}`);
	}
	let key = parts[1];
	const b = parts.indexOf("branch");
	if (b === 2 && parts[3]) key = parts[3];
	const node = url.searchParams.get("node-id");
	return { key, nodeId: node ? normalizeNodeId(node) : undefined };
}

/** Parse "ids" input: array and/or comma separated. */
export function normalizeIds(ids: readonly string[] | undefined): string[] {
	return (ids ?? []).flatMap((s) => s.split(",")).map((s) => normalizeNodeId(s)).filter(Boolean);
}
