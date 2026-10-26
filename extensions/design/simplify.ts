/** Figma node tree -> compact design tree (DNode) that is cheap for an LLM to read and to generate code from. */
import { type Css, type FNode, cssString, nodeCss, textCss } from "./css.ts";

export interface DNode {
	id: string;
	name: string;
	type: string;
	css: Css;
	/** Component the instance comes from. */
	component?: string;
	/** Named Figma styles applied (fill/text/effect...). */
	styles?: Record<string, string>;
	text?: string;
	/** Styled text runs when a text node mixes styles. */
	runs?: { text: string; css: Css }[];
	/** Should be exported as an asset (icon/illustration) instead of rebuilt. */
	asset?: "svg";
	/** Image fill reference (use figma_download_image_fills / figma_get_screenshot). */
	imageRef?: string;
	children?: DNode[];
	/** True when children were cut off by depth/maxNodes. */
	truncated?: boolean;
}

export interface SimplifyOptions {
	depth?: number;
	maxNodes?: number;
	/** id -> {name} maps from the API response. */
	components?: Record<string, FNode>;
	styles?: Record<string, FNode>;
}

const VECTORS = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE", "REGULAR_POLYGON"]);
const CONTAINERS = new Set(["GROUP", "FRAME", "INSTANCE", "COMPONENT", "COMPONENT_SET"]);

/** A container whose whole subtree is vector shapes: treat as one icon. */
function isIcon(node: FNode): boolean {
	if (VECTORS.has(node.type)) return true;
	if (!CONTAINERS.has(node.type) || !node.children?.length) return false;
	const hasImage = (node.fills ?? []).some((f: FNode) => f.type === "IMAGE" && f.visible !== false);
	if (hasImage) return false;
	return node.children.filter((c: FNode) => c.visible !== false).every(isIcon);
}

export function simplify(root: FNode, o: SimplifyOptions = {}): DNode {
	const maxDepth = o.depth ?? 6;
	const budget = { left: o.maxNodes ?? 400 };

	const walk = (node: FNode, parent: FNode | undefined, depth: number): DNode => {
		budget.left--;
		const d: DNode = { id: node.id, name: node.name, type: node.type, css: {} };
		if (node.type === "TEXT") {
			d.css = { ...nodeCss(node, { parent }), ...textCss(node.style, node.fills) };
			d.text = node.characters ?? "";
			d.runs = textRuns(node);
			if (!d.runs) delete d.runs;
		} else if (isIcon(node)) {
			d.css = nodeCss(node, { parent });
			d.asset = "svg";
			return d;
		} else d.css = nodeCss(node, { parent });

		if (node.componentId) d.component = o.components?.[node.componentId]?.name ?? node.componentId;
		if (node.styles && o.styles) {
			const named = Object.fromEntries(Object.entries(node.styles as Record<string, string>).map(([k, id]) => [k, o.styles?.[id]?.name ?? id]));
			if (Object.keys(named).length) d.styles = named;
		}
		const img = (node.fills ?? []).find((f: FNode) => f.type === "IMAGE" && f.visible !== false);
		if (img?.imageRef) d.imageRef = img.imageRef;

		const kids: FNode[] = (node.children ?? []).filter((c: FNode) => c.visible !== false);
		if (kids.length) {
			if (depth >= maxDepth) d.truncated = true;
			else {
				d.children = [];
				for (const k of kids) {
					if (budget.left <= 0) {
						d.truncated = true;
						break;
					}
					d.children.push(walk(k, node, depth + 1));
				}
			}
		}
		return d;
	};
	return walk(root, undefined, 0);
}

function textRuns(node: FNode): DNode["runs"] {
	const ov: number[] | undefined = node.characterStyleOverrides;
	const table: Record<string, FNode> | undefined = node.styleOverrideTable;
	if (!ov?.length || !table || !ov.some((x) => x)) return undefined;
	const chars: string = node.characters ?? "";
	const runs: NonNullable<DNode["runs"]> = [];
	let start = 0;
	const at = (i: number) => ov[i] ?? 0;
	for (let i = 1; i <= chars.length; i++) {
		if (i === chars.length || at(i) !== at(start)) {
			const id = at(start);
			const base = textCss(node.style, node.fills);
			const own = id ? textCss({ ...node.style, ...table[String(id)] }, table[String(id)]?.fills ?? node.fills) : base;
			const diff: Css = Object.fromEntries(Object.entries(own).filter(([k, v]) => base[k] !== v));
			runs.push({ text: chars.slice(start, i), css: diff });
			start = i;
		}
	}
	return runs;
}

export function countNodes(d: DNode): number {
	return 1 + (d.children ?? []).reduce((a, c) => a + countNodes(c), 0);
}

/** Collect every asset-candidate (icons) and image fill in the tree. */
export function collectAssets(d: DNode, out: { icons: DNode[]; images: DNode[] } = { icons: [], images: [] }) {
	if (d.asset) out.icons.push(d);
	if (d.imageRef) out.images.push(d);
	for (const c of d.children ?? []) collectAssets(c, out);
	return out;
}

/** Indented outline: one line per node, easy to skim; css inline. */
export function outline(d: DNode, indent = 0): string {
	const pad = "  ".repeat(indent);
	const bits = [`${pad}${d.type} "${d.name}" #${d.id}`];
	if (d.component) bits.push(`<${d.component}>`);
	if (d.asset) bits.push("[svg-asset]");
	if (d.imageRef) bits.push(`[image:${d.imageRef}]`);
	if (d.text !== undefined) bits.push(`text=${JSON.stringify(d.text.length > 200 ? d.text.slice(0, 200) + "…" : d.text)}`);
	if (d.styles) bits.push(`styles=${JSON.stringify(d.styles)}`);
	const css = cssString(d.css);
	if (css) bits.push(`{ ${css} }`);
	if (d.truncated) bits.push("(…children truncated)");
	const lines = [bits.join(" ")];
	for (const r of d.runs ?? []) lines.push(`${pad}  run ${JSON.stringify(r.text)} { ${cssString(r.css)} }`);
	for (const c of d.children ?? []) lines.push(outline(c, indent + 1));
	return lines.join("\n");
}
