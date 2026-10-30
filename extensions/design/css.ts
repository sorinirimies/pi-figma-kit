/** Figma node -> CSS declarations. Pure functions over the REST API node JSON. */
export type Css = Record<string, string>;
export type FNode = Record<string, any>;

export const n = (v: number): string => String(Math.round(v * 100) / 100);
export const px = (v: number): string => `${n(v)}px`;
export const pct = (v: number): string => `${n(v * 100)}%`;

export function color(c: { r: number; g: number; b: number; a?: number } | null | undefined, opacity = 1): string {
	if (!c) return "transparent";
	const a = (c.a ?? 1) * opacity;
	const h = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
	return a >= 0.995 ? `#${h(c.r)}${h(c.g)}${h(c.b)}` : `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${n(a)})`;
}

const visible = (xs: FNode[] | undefined): FNode[] => (xs ?? []).filter((x) => x.visible !== false);

function stops(p: FNode): string {
	return (p.gradientStops ?? []).map((s: FNode) => `${color(s.color, p.opacity ?? 1)} ${n(s.position * 100)}%`).join(", ");
}

/** One paint -> CSS background layer (or a plain color for SOLID). */
export function paintLayer(p: FNode): string | undefined {
	switch (p.type) {
		case "SOLID":
			return color(p.color, p.opacity ?? 1);
		case "GRADIENT_LINEAR": {
			const [a, b] = p.gradientHandlePositions ?? [];
			let deg = 180;
			if (a && b) deg = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
			return `linear-gradient(${n((deg + 360) % 360)}deg, ${stops(p)})`;
		}
		case "GRADIENT_RADIAL":
		case "GRADIENT_DIAMOND": {
			// Handles (node-relative 0..1): center, end of the first radius, end of the second radius.
			const [c, h1, h2] = p.gradientHandlePositions ?? [];
			if (!c || !h1 || !h2) return `radial-gradient(circle, ${stops(p)})`;
			const r1 = Math.hypot(h1.x - c.x, h1.y - c.y);
			const r2 = Math.hypot(h2.x - c.x, h2.y - c.y);
			return `radial-gradient(ellipse ${pct(r1)} ${pct(r2)} at ${pct(c.x)} ${pct(c.y)}, ${stops(p)})`;
		}
		case "GRADIENT_ANGULAR": {
			const [c, h1] = p.gradientHandlePositions ?? [];
			if (!c || !h1) return `conic-gradient(${stops(p)})`;
			const deg = (Math.atan2(h1.x - c.x, -(h1.y - c.y)) * 180) / Math.PI;
			return `conic-gradient(from ${n((deg + 360) % 360)}deg at ${pct(c.x)} ${pct(c.y)}, ${stops(p)})`;
		}
		case "IMAGE":
			return `url(figma-image:${p.imageRef ?? "unknown"})`;
		default:
			return undefined;
	}
}

export function fillCss(fills: FNode[] | undefined): Css {
	const layers = visible(fills).map((p) => ({ p, v: paintLayer(p) })).filter((x) => x.v);
	if (!layers.length) return {};
	if (layers.length === 1 && layers[0]!.p.type === "SOLID") return { background: layers[0]!.v! };
	const css: Css = {};
	// Figma lists bottom-first; CSS lists top-first.
	const ordered = [...layers].reverse();
	css.background = ordered.map(({ p, v }) => (p.type === "SOLID" ? `linear-gradient(${v}, ${v})` : v)).join(", ");
	const img = ordered.find((l) => l.p.type === "IMAGE")?.p;
	if (img) {
		const m = img.scaleMode;
		css["background-size"] = m === "FIT" ? "contain" : m === "STRETCH" ? "100% 100%" : m === "TILE" ? "auto" : "cover";
		css["background-position"] = "center";
		if (m !== "TILE") css["background-repeat"] = "no-repeat";
	}
	return css;
}

export function textColor(fills: FNode[] | undefined): string | undefined {
	const p = visible(fills).find((f) => f.type === "SOLID");
	if (p) return color(p.color, p.opacity ?? 1);
	const g = visible(fills).map(paintLayer).find(Boolean);
	return g;
}

function corners(node: FNode): Css {
	const r: number[] | undefined = node.rectangleCornerRadii;
	if (r && r.some((v) => v)) return { "border-radius": r.every((v) => v === r[0]) ? px(r[0]!) : r.map(px).join(" ") };
	if (node.cornerRadius) return { "border-radius": px(node.cornerRadius) };
	if (node.type === "ELLIPSE") return { "border-radius": "50%" };
	return {};
}

function strokes(node: FNode): Css {
	const p = visible(node.strokes).find((s) => s.type === "SOLID") ?? visible(node.strokes)[0];
	if (!p) return {};
	const col = p.type === "SOLID" ? color(p.color, p.opacity ?? 1) : "currentColor";
	const style = node.strokeDashes?.length ? "dashed" : "solid";
	const css: Css = {};
	const ind = node.individualStrokeWeights;
	const outside = node.strokeAlign === "OUTSIDE";
	if (ind) {
		for (const [side, key] of [["top", "top"], ["right", "right"], ["bottom", "bottom"], ["left", "left"]] as const) {
			if (ind[key]) css[`border-${side}`] = `${px(ind[key])} ${style} ${col}`;
		}
	} else if (node.strokeWeight) {
		css[outside ? "outline" : "border"] = `${px(node.strokeWeight)} ${style} ${col}`;
	}
	return css;
}

function effects(node: FNode): Css {
	const shadows: string[] = [];
	const css: Css = {};
	for (const e of visible(node.effects)) {
		if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
			shadows.push(`${e.type === "INNER_SHADOW" ? "inset " : ""}${px(e.offset?.x ?? 0)} ${px(e.offset?.y ?? 0)} ${px(e.radius ?? 0)} ${px(e.spread ?? 0)} ${color(e.color)}`);
		} else if (e.type === "LAYER_BLUR") css.filter = `blur(${px((e.radius ?? 0) / 2)})`;
		else if (e.type === "BACKGROUND_BLUR") css["backdrop-filter"] = `blur(${px((e.radius ?? 0) / 2)})`;
	}
	if (shadows.length) css[node.type === "TEXT" ? "text-shadow" : "box-shadow"] = shadows.join(", ");
	return css;
}

const JUSTIFY: Record<string, string> = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between" };
const ALIGN: Record<string, string> = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline" };

function autoLayout(node: FNode): Css {
	if (!node.layoutMode || node.layoutMode === "NONE") return {};
	const css: Css = { display: "flex", "flex-direction": node.layoutMode === "VERTICAL" ? "column" : "row" };
	if (node.layoutWrap === "WRAP") css["flex-wrap"] = "wrap";
	if (node.itemSpacing) css.gap = px(node.itemSpacing);
	const [t, r, b, l] = [node.paddingTop ?? 0, node.paddingRight ?? 0, node.paddingBottom ?? 0, node.paddingLeft ?? 0];
	if (t || r || b || l) css.padding = t === r && r === b && b === l ? px(t) : t === b && l === r ? `${px(t)} ${px(r)}` : `${px(t)} ${px(r)} ${px(b)} ${px(l)}`;
	if (node.primaryAxisAlignItems && node.primaryAxisAlignItems !== "MIN") css["justify-content"] = JUSTIFY[node.primaryAxisAlignItems] ?? "flex-start";
	if (node.counterAxisAlignItems && node.counterAxisAlignItems !== "MIN") css["align-items"] = ALIGN[node.counterAxisAlignItems] ?? "flex-start";
	return css;
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * Figma constraints -> CSS offsets along one axis. MIN/default = left/top, MAX = right/bottom,
 * STRETCH (LEFT_RIGHT/TOP_BOTTOM) = both edges and no fixed size, CENTER = offset from the middle, SCALE = percentages.
 */
function anchor(bb: Box, pb: Box, constraints: FNode | undefined, css: Css): Css {
	const out: Css = {};
	const axis = (mode: string | undefined, start: "left" | "top", end: "right" | "bottom", size: "width" | "height", pos: number, len: number, plen: number) => {
		const before = pos;
		const after = plen - pos - len;
		switch (mode) {
			case "RIGHT":
			case "BOTTOM":
				out[end] = px(after);
				break;
			case "LEFT_RIGHT":
			case "TOP_BOTTOM":
				out[start] = px(before);
				out[end] = px(after);
				delete css[size];
				break;
			case "CENTER": {
				const off = before - plen / 2; // keeps the distance from the parent's center
				out[start] = off ? `calc(50% ${off < 0 ? "-" : "+"} ${px(Math.abs(off))})` : "50%";
				break;
			}
			case "SCALE":
				if (plen) {
					out[start] = pct(before / plen);
					if (css[size]) out[size] = pct(len / plen);
					break;
				}
				out[start] = px(before);
				break;
			default:
				out[start] = px(before);
		}
	};
	axis(constraints?.horizontal, "left", "right", "width", bb.x - pb.x, bb.width, pb.width);
	axis(constraints?.vertical, "top", "bottom", "height", bb.y - pb.y, bb.height, pb.height);
	return out;
}

const isAuto = (n?: FNode) => !!n && !!n.layoutMode && n.layoutMode !== "NONE";

export interface StyleCtx {
	parent?: FNode;
}

/** Layout + visual declarations for any non-text-specific node. */
export function nodeCss(node: FNode, { parent }: StyleCtx = {}): Css {
	const css: Css = {};
	const bb = node.absoluteBoundingBox;
	const inAuto = isAuto(parent) && node.layoutPositioning !== "ABSOLUTE";
	const horizontalParent = parent?.layoutMode === "HORIZONTAL";
	const isText = node.type === "TEXT";

	// Size
	const sh = node.layoutSizingHorizontal as string | undefined;
	const sv = node.layoutSizingVertical as string | undefined;
	if (bb) {
		const wAuto = isText ? node.style?.textAutoResize === "WIDTH_AND_HEIGHT" : sh === "HUG";
		const hAuto = isText ? node.style?.textAutoResize !== "NONE" && node.style?.textAutoResize !== "TRUNCATE" : sv === "HUG";
		if (inAuto && sh === "FILL") {
			if (horizontalParent) css.flex = "1 1 0";
			else css["align-self"] = "stretch";
		} else if (!wAuto) css.width = px(bb.width);
		if (inAuto && sv === "FILL") {
			if (!horizontalParent) css.flex = "1 1 0";
			else css["align-self"] = "stretch";
		} else if (!hAuto) css.height = px(bb.height);
	}
	if (inAuto && node.layoutGrow === 1 && !css.flex) css.flex = "1 1 0";
	if (inAuto && node.layoutAlign === "STRETCH" && !css["align-self"]) css["align-self"] = "stretch";
	if (node.minWidth) css["min-width"] = px(node.minWidth);
	if (node.maxWidth) css["max-width"] = px(node.maxWidth);
	if (node.minHeight) css["min-height"] = px(node.minHeight);
	if (node.maxHeight) css["max-height"] = px(node.maxHeight);

	// Position: absolute in the parent, anchored the way the Figma constraints say.
	if (parent && !inAuto && bb && parent.absoluteBoundingBox) {
		css.position = "absolute";
		Object.assign(css, anchor(bb, parent.absoluteBoundingBox, node.constraints, css));
	}
	if (css.position !== "absolute" && !parent) css.position = css.position ?? "relative";

	Object.assign(css, autoLayout(node));
	if (node.children?.length && !isAuto(node) && !css.position) css.position = "relative";

	if (!isText) {
		Object.assign(css, fillCss(node.fills), corners(node), strokes(node));
	}
	Object.assign(css, effects(node));
	if (node.clipsContent && node.children?.length) css.overflow = "hidden";
	if (node.opacity !== undefined && node.opacity < 1) css.opacity = n(node.opacity);
	if (node.blendMode && !["NORMAL", "PASS_THROUGH"].includes(node.blendMode)) css["mix-blend-mode"] = String(node.blendMode).toLowerCase().replace(/_/g, "-");
	if (node.rotation && Math.abs(node.rotation) > 0.001) css.transform = `rotate(${n((-node.rotation * 180) / Math.PI)}deg)`;
	if (node.visible === false) css.display = "none";
	return css;
}

const TEXT_ALIGN: Record<string, string> = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" };
const TEXT_CASE: Record<string, string> = { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize" };

/** Typography from a Figma `style` object (TypeStyle). */
export function textCss(style: FNode | undefined, fills?: FNode[]): Css {
	const css: Css = {};
	if (!style) return css;
	if (style.fontFamily) css["font-family"] = `'${style.fontFamily}'`;
	if (style.fontSize) css["font-size"] = px(style.fontSize);
	if (style.fontWeight) css["font-weight"] = String(style.fontWeight);
	if (style.italic) css["font-style"] = "italic";
	if (style.lineHeightPx) css["line-height"] = px(style.lineHeightPx);
	if (style.letterSpacing) css["letter-spacing"] = px(style.letterSpacing);
	if (style.textAlignHorizontal && style.textAlignHorizontal !== "LEFT") css["text-align"] = TEXT_ALIGN[style.textAlignHorizontal] ?? "left";
	if (style.textCase && TEXT_CASE[style.textCase]) css["text-transform"] = TEXT_CASE[style.textCase]!;
	if (style.textDecoration === "UNDERLINE") css["text-decoration"] = "underline";
	else if (style.textDecoration === "STRIKETHROUGH") css["text-decoration"] = "line-through";
	const c = textColor(fills);
	if (c) css.color = c;
	return css;
}

export const cssString = (css: Css): string => Object.entries(css).map(([k, v]) => `${k}: ${v}`).join("; ");
