/**
 * Token bindings: which CSS values of a node come from a design token, as `var(--token, fallback)`.
 *
 * Sources, best first:
 *   1. Figma variables bound to node fields (`boundVariables`), names from GET /variables/local.
 *   2. Named fill/stroke styles (`node.styles`), names from the nodes response.
 * Names go through `cssVar`, the same naming figma_export_tokens uses, so generated code and exported tokens match.
 * The result is an overlay on top of the raw `css` (which stays literal for parsers such as the Compose generator).
 */
import { type Css, type FNode, color, px } from "./css.ts";
import { cssVar } from "./tokens.ts";

/** Variable id -> variable name ("spacing/md"). */
export type VarNames = (id: string) => string | undefined;

const visible = (xs: FNode[] | undefined): FNode[] => (xs ?? []).filter((x) => x.visible !== false);
const ref = (name: string, fallback: string) => `var(${cssVar(name)}, ${fallback})`;

/** The variable id of a binding: an alias, or an array of aliases that all point to the same variable (text ranges). */
function aliasId(b: unknown): string | undefined {
	if (Array.isArray(b)) {
		const ids = [...new Set(b.map(aliasId))];
		return ids.length === 1 ? ids[0] : undefined;
	}
	return b && typeof b === "object" && (b as FNode).type === "VARIABLE_ALIAS" ? (b as FNode).id : undefined;
}

/** "16px" / "16px 24px" / 4 values, collapsed like the plain CSS generator does. */
function box(v: [string, string, string, string]): string {
	const [t, r, b, l] = v;
	return t === r && r === b && b === l ? t : t === b && l === r ? `${t} ${r}` : v.join(" ");
}

/** The one solid paint a property can be bound through, if the fills are exactly that. */
function soloSolid(paints: FNode[] | undefined): FNode | undefined {
	const v = visible(paints);
	return v.length === 1 && v[0]!.type === "SOLID" ? v[0] : undefined;
}

export interface BindOptions {
	/** Variable names; when missing, only styles are used. */
	names?: VarNames;
	/** Style id -> style node ({ name }) from the nodes response. */
	styles?: Record<string, FNode>;
}

/** CSS overrides for the token-bound values of `node`, given its raw `css`. Empty when nothing is bound. */
export function bindTokens(node: FNode, css: Css, o: BindOptions): Css {
	const out: Css = {};
	const bv: FNode = node.boundVariables ?? {};
	const name = (field: string): string | undefined => {
		const id = aliasId(bv[field]);
		return id ? o.names?.(id) : undefined;
	};
	const isText = node.type === "TEXT";

	// Simple 1:1 fields.
	const simple: [string, string, (v: any) => string][] = [
		["itemSpacing", "gap", px],
		["width", "width", px],
		["height", "height", px],
		["minWidth", "min-width", px],
		["maxWidth", "max-width", px],
		["minHeight", "min-height", px],
		["maxHeight", "max-height", px],
		["opacity", "opacity", String],
	];
	for (const [field, prop, fmt] of simple) {
		const nm = name(field);
		if (nm && css[prop] !== undefined) out[prop] = ref(nm, css[prop]!);
		else if (nm && field === "opacity" && node.opacity !== undefined) out[prop] = ref(nm, fmt(node.opacity));
	}

	// Padding / radius: per side, so partial bindings still work.
	if (css.padding) {
		const sides = (["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const).map((f) => {
			const nm = name(f);
			return nm ? ref(nm, px(node[f] ?? 0)) : px(node[f] ?? 0);
		}) as [string, string, string, string];
		if (sides.some((s) => s.startsWith("var("))) out.padding = box(sides);
	}
	if (css["border-radius"] && css["border-radius"] !== "50%") {
		const r: number[] = node.rectangleCornerRadii ?? [node.cornerRadius ?? 0, node.cornerRadius ?? 0, node.cornerRadius ?? 0, node.cornerRadius ?? 0];
		const corners = (["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"] as const).map((f, i) => {
			const nm = name(f);
			return nm ? ref(nm, px(r[i] ?? 0)) : px(r[i] ?? 0);
		}) as [string, string, string, string];
		if (corners.some((s) => s.startsWith("var("))) out["border-radius"] = corners.every((c) => c === corners[0]) ? corners[0] : corners.join(" ");
	}

	// Typography.
	if (isText) {
		const typo: [string, string, (s: FNode) => string | undefined][] = [
			["fontSize", "font-size", (s) => (s.fontSize ? px(s.fontSize) : undefined)],
			["fontWeight", "font-weight", (s) => (s.fontWeight ? String(s.fontWeight) : undefined)],
			["lineHeight", "line-height", (s) => (s.lineHeightPx ? px(s.lineHeightPx) : undefined)],
			["letterSpacing", "letter-spacing", (s) => (s.letterSpacing ? px(s.letterSpacing) : undefined)],
			["fontFamily", "font-family", (s) => (s.fontFamily ? `'${s.fontFamily}'` : undefined)],
		];
		for (const [field, prop, raw] of typo) {
			const nm = name(field);
			const v = css[prop] ?? raw(node.style ?? {});
			if (nm && v) out[prop] = ref(nm, v);
		}
	}

	// Colors: a paint's bound color variable, else the node's fill/stroke style.
	const styleName = (kind: string): string | undefined => {
		const id = node.styles?.[kind] ?? node.styles?.[`${kind}s`];
		return id ? o.styles?.[id]?.name : undefined;
	};
	const paintName = (paint: FNode | undefined, kind: "fill" | "stroke"): string | undefined => {
		if (!paint) return undefined;
		const id = aliasId(paint.boundVariables?.color);
		return (id && o.names?.(id)) || styleName(kind);
	};
	const fill = soloSolid(node.fills);
	const fillName = paintName(fill, "fill");
	if (fill && fillName) {
		const prop = isText ? "color" : "background";
		if (css[prop]) out[prop] = ref(fillName, css[prop]!);
	}
	const stroke = soloSolid(node.strokes);
	const strokeName = paintName(stroke, "stroke");
	if (stroke && strokeName) {
		const col = color(stroke.color, stroke.opacity ?? 1);
		for (const prop of ["border", "outline", "border-top", "border-right", "border-bottom", "border-left"]) {
			const v = css[prop];
			if (v?.endsWith(` ${col}`)) out[prop] = `${v.slice(0, -col.length)}${ref(strokeName, col)}`;
		}
	}
	return out;
}

/** Variable ids referenced anywhere in a raw subtree (to decide whether names are worth fetching). */
export function hasBoundVariables(node: FNode): boolean {
	if (node.boundVariables && Object.keys(node.boundVariables).length) return true;
	for (const p of [...(node.fills ?? []), ...(node.strokes ?? [])]) if (p?.boundVariables && Object.keys(p.boundVariables).length) return true;
	return (node.children ?? []).some(hasBoundVariables);
}

/** Token names used in a CSS overlay, for comments in non-CSS output. */
export const varNames = (vars: Css | undefined): string[] => [...new Set(Object.values(vars ?? {}).flatMap((v) => [...v.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!)))];
