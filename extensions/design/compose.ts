/** DNode -> Jetpack Compose scaffold (Column/Row/Box + Modifier chains, Text, Icon/Image). */
import type { DNode } from "./simplify.ts";
import { varNames } from "./bindings.ts";
import { type SharedComponent, pascal, sharedComponents, slug, splitPlacement } from "./codegen.ts";

const num = (v: string | undefined): number | undefined => {
	const m = v && /^(-?[\d.]+)px$/.exec(v.trim());
	return m ? Number(m[1]) : undefined;
};
const dp = (v: number) => `${Math.round(v * 100) / 100}.dp`;
const sp = (v: number) => `${Math.round(v * 100) / 100}.sp`;

/** "#rrggbb" | "rgba(r, g, b, a)" -> Color(0xAARRGGBB). */
export function composeColor(c: string | undefined): string | undefined {
	if (!c) return undefined;
	const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
	if (hex) return `Color(0xFF${hex[1]!.toUpperCase()})`;
	const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(c.trim());
	if (m) {
		const h = (x: number) => Math.round(x).toString(16).padStart(2, "0").toUpperCase();
		return `Color(0x${h(Number(m[4]) * 255)}${h(Number(m[1]))}${h(Number(m[2]))}${h(Number(m[3]))})`;
	}
	return undefined;
}

const firstColor = (bg: string | undefined) => (bg && !bg.includes("gradient") ? composeColor(bg) : undefined);

function shape(css: Record<string, string>): string | undefined {
	const r = css["border-radius"];
	if (!r) return undefined;
	if (r === "50%") return "CircleShape";
	const parts = r.split(" ").map(num);
	if (parts.some((p) => p === undefined)) return undefined;
	if (parts.length === 4) return `RoundedCornerShape(${parts.map((p) => dp(p!)).join(", ")})`;
	return `RoundedCornerShape(${dp(parts[0]!)})`;
}

const ARR: Record<string, string> = { center: "Center", "space-between": "SpaceBetween", "flex-end": "End" };
const ALIGN_V: Record<string, string> = { center: "CenterVertically", "flex-end": "Bottom", "flex-start": "Top" };
const ALIGN_H: Record<string, string> = { center: "CenterHorizontally", "flex-end": "End", "flex-start": "Start" };

function modifier(d: DNode, parentKind: "Column" | "Row" | "Box" | undefined, notes: string[] = []): string[] {
	const c = d.css;
	const m: string[] = [];
	if (c.position === "absolute") {
		if (num(c.left) !== undefined && num(c.top) !== undefined) m.push(`offset(${dp(num(c.left)!)}, ${dp(num(c.top)!)})`);
		else {
			const at = ["left", "right", "top", "bottom"].filter((k) => c[k]).map((k) => `${k}: ${c[k]}`).join(", ");
			notes.push(`// TODO: constrained position (${at}) → Modifier.align(…) + padding/offset in the parent Box`);
		}
	}
	const w = num(c.width);
	const h = num(c.height);
	let fillW = false;
	let fillH = false;
	if (c.flex?.startsWith("1")) {
		m.push("weight(1f)");
		if (parentKind === "Row") fillW = true;
		else fillH = true;
	}
	if (c["align-self"] === "stretch") {
		if (parentKind === "Row") (m.push("fillMaxHeight()"), (fillH = true));
		else (m.push("fillMaxWidth()"), (fillW = true));
	}
	if (w !== undefined && h !== undefined && !fillW && !fillH) m.push(`size(${dp(w)}, ${dp(h)})`);
	else {
		if (w !== undefined && !fillW) m.push(`width(${dp(w)})`);
		if (h !== undefined && !fillH) m.push(`height(${dp(h)})`);
	}
	const sh = shape(c);
	if (c["box-shadow"] && !c["box-shadow"].startsWith("inset")) {
		const blur = num(c["box-shadow"].split(" ")[2]);
		if (blur) m.push(`shadow(${dp(blur)}${sh ? `, ${sh}` : ""})`);
	}
	if (c.opacity) m.push(`alpha(${c.opacity}f)`);
	if (c.transform?.startsWith("rotate(")) m.push(`rotate(${c.transform.slice(7, -4)}f)`);
	if (c.overflow === "hidden" && sh) m.push(`clip(${sh})`);
	const bg = firstColor(c.background);
	if (bg) m.push(`background(${bg}${sh ? `, ${sh}` : ""})`);
	else if (c.background?.includes("gradient")) notes.push(`// TODO gradient: ${c.background}`);
	if (c.border) {
		const [bw, , ...col] = c.border.split(" ");
		const bc = composeColor(col.join(" "));
		if (num(bw) !== undefined && bc) m.push(`border(${dp(num(bw)!)}, ${bc}${sh ? `, ${sh}` : ""})`);
	}
	if (c.padding) {
		const p = c.padding.split(" ").map(num);
		if (p.every((x) => x !== undefined)) {
			if (p.length === 1) m.push(`padding(${dp(p[0]!)})`);
			else if (p.length === 2) m.push(`padding(horizontal = ${dp(p[1]!)}, vertical = ${dp(p[0]!)})`);
			else m.push(`padding(start = ${dp(p[3]!)}, top = ${dp(p[0]!)}, end = ${dp(p[1]!)}, bottom = ${dp(p[2]!)})`);
		}
	}
	return m;
}

/** `modifier = Modifier.a().b()`; `base` is "modifier" inside a shared component (the caller's modifier comes first). */
const mod = (parts: string[], pad: string, base = "Modifier") =>
	parts.length ? `modifier = ${base}\n${parts.map((p) => `${pad}        .${p}`).join("\n")}` : base === "Modifier" ? "" : `modifier = ${base}`;

const str = (s: string) => JSON.stringify(s).replace(/\$/g, "\\$");

const L = "androidx.compose.foundation.layout";
const IMPORTS: [RegExp, string][] = [
	[/\bModifier\b/, "androidx.compose.ui.Modifier"],
	[/\d\.dp\b/, "androidx.compose.ui.unit.dp"],
	[/\d\.sp\b/, "androidx.compose.ui.unit.sp"],
	[/\bColumn\(/, `${L}.Column`], [/\bRow\(/, `${L}.Row`], [/\bBox\(/, `${L}.Box`],
	[/\bArrangement\./, `${L}.Arrangement`], [/\bAlignment\./, "androidx.compose.ui.Alignment"],
	[/\.offset\(/, `${L}.offset`], [/\.padding\(/, `${L}.padding`], [/\.size\(/, `${L}.size`], [/\.width\(/, `${L}.width`], [/\.height\(/, `${L}.height`],
	[/\.fillMaxWidth\(/, `${L}.fillMaxWidth`], [/\.fillMaxHeight\(/, `${L}.fillMaxHeight`],
	[/\.background\(/, "androidx.compose.foundation.background"], [/\.border\(/, "androidx.compose.foundation.border"],
	[/\.shadow\(/, "androidx.compose.ui.draw.shadow"], [/\.alpha\(/, "androidx.compose.ui.draw.alpha"], [/\.rotate\(/, "androidx.compose.ui.draw.rotate"], [/\.clip\(/, "androidx.compose.ui.draw.clip"],
	[/\bRoundedCornerShape\(/, "androidx.compose.foundation.shape.RoundedCornerShape"], [/\bCircleShape\b/, "androidx.compose.foundation.shape.CircleShape"],
	[/\bColor\(/, "androidx.compose.ui.graphics.Color"],
	[/\bText\(/, "androidx.compose.material3.Text"], [/\bIcon\(/, "androidx.compose.material3.Icon"], [/\bImage\(/, "androidx.compose.foundation.Image"],
	[/painterResource/, "androidx.compose.ui.res.painterResource"],
	[/\bFontWeight\(/, "androidx.compose.ui.text.font.FontWeight"], [/\bFontStyle\./, "androidx.compose.ui.text.font.FontStyle"],
	[/\bTextAlign\./, "androidx.compose.ui.text.style.TextAlign"], [/\bTextDecoration\./, "androidx.compose.ui.text.style.TextDecoration"],
];

export interface ComposeResult {
	code: string;
	imports: string[];
}

export function generateCompose(root: DNode, name = pascal(root.name)): ComposeResult {
	const shared = sharedComponents(root, [name]);
	const defined = new Map<SharedComponent, string>();
	type Kind = "Column" | "Row" | "Box" | undefined;
	/** While emitting a shared component: its root takes `modifier`, its texts are parameters. */
	type Def = { root: DNode; textProp: Map<DNode, string> };

	const textsOf = (d: DNode, out: DNode[] = []): DNode[] => {
		if (d.text !== undefined && !d.runs) out.push(d);
		for (const c of d.children ?? []) textsOf(c, out);
		return out;
	};

	const define = (sc: SharedComponent): string => {
		const def: Def = { root: sc.template, textProp: new Map(sc.props.map((p) => [p.node, p.prop])) };
		const body = emit(sc.template, 1, undefined, def);
		const params = ["modifier: Modifier = Modifier", ...sc.props.map((p) => `${p.prop}: String = ${str(p.node.text!)}`)];
		return `@Composable\nfun ${sc.name}(\n${params.map((x) => `    ${x},`).join("\n")}\n) {\n${body}\n}\n`;
	};

	/** Call of a shared component, with this instance's placement and differing texts. */
	const call = (d: DNode, sc: SharedComponent, indent: number, parent: Kind, notes: string[]): string => {
		if (!defined.has(sc)) defined.set(sc, define(sc));
		const pad = "    ".repeat(indent);
		const args: string[] = [];
		const m = mod(modifier({ ...d, css: splitPlacement(d.css).place }, parent, notes), pad);
		if (m) args.push(m);
		const texts = textsOf(d);
		sc.props.forEach(({ node, prop }, i) => {
			const t = texts[i]?.text;
			if (t !== undefined && t !== node.text) args.push(`${prop} = ${str(t)}`);
		});
		return args.length ? `${pad}${sc.name}(\n${args.map((a) => `${pad}    ${a},`).join("\n")}\n${pad})` : `${pad}${sc.name}()`;
	};

	const emit = (d: DNode, indent: number, parent: Kind, def?: Def): string => {
		const notes: string[] = [];
		const tokens = varNames(d.vars);
		if (tokens.length) notes.push(`// tokens: ${tokens.join(", ")}`);
		const sc = def ? undefined : shared.get(d);
		const out = sc ? call(d, sc, indent, parent, notes) : emitNode(d, indent, parent, notes, def);
		const pad = "    ".repeat(indent);
		return notes.length ? `${notes.map((x) => `${pad}${x}`).join("\n")}\n${out}` : out;
	};
	const emitNode = (d: DNode, indent: number, parent: Kind, notes: string[], def?: Def): string => {
		const pad = "    ".repeat(indent);
		const c = d.css;
		const isDefRoot = def?.root === d;
		// A shared component's root: own styling only; the caller's modifier carries the placement.
		const modOf = () => (isDefRoot ? mod(modifier({ ...d, css: splitPlacement(c).own }, undefined, notes), pad, "modifier") : mod(modifier(d, parent, notes), pad));
		if (d.asset || (d.imageRef && !d.children?.length)) {
			const res = `R.drawable.${slug(d.asset ? d.name : d.imageRef!).replace(/-/g, "_")}`;
			const m = modOf();
			const args = [`painter = painterResource(${res})`, `contentDescription = ${str(d.name)}`, ...(m ? [m] : [])];
			return `${pad}${d.asset ? "Icon" : "Image"}(\n${args.map((a) => `${pad}    ${a},`).join("\n")}\n${pad})`;
		}
		if (d.text !== undefined) {
			const prop = def?.textProp.get(d);
			const args = [`text = ${prop ?? str(d.text)}`];
			const col = composeColor(c.color);
			if (col) args.push(`color = ${col}`);
			if (num(c["font-size"])) args.push(`fontSize = ${sp(num(c["font-size"])!)}`);
			if (c["font-weight"]) args.push(`fontWeight = FontWeight(${c["font-weight"]})`);
			if (c["font-style"] === "italic") args.push("fontStyle = FontStyle.Italic");
			if (num(c["line-height"])) args.push(`lineHeight = ${sp(num(c["line-height"])!)}`);
			if (num(c["letter-spacing"])) args.push(`letterSpacing = ${sp(num(c["letter-spacing"])!)}`);
			if (c["text-align"]) args.push(`textAlign = TextAlign.${c["text-align"][0]!.toUpperCase()}${c["text-align"].slice(1).replace("justify", "Justify")}`);
			if (c["text-decoration"]) args.push(`textDecoration = TextDecoration.${c["text-decoration"] === "underline" ? "Underline" : "LineThrough"}`);
			const m = modOf();
			if (m) args.push(m);
			return `${pad}Text(\n${args.map((a) => `${pad}    ${a},`).join("\n")}\n${pad})`;
		}
		const kind: "Column" | "Row" | "Box" = c["flex-direction"] === "column" ? "Column" : c["flex-direction"] === "row" ? "Row" : "Box";
		const args: string[] = [];
		const mm = modOf();
		if (mm) args.push(mm);
		if (kind !== "Box") {
			const gap = num(c.gap);
			const jc = ARR[c["justify-content"] ?? ""];
			const col = kind === "Column";
			let arr: string | undefined;
			if (jc === "SpaceBetween") arr = "Arrangement.SpaceBetween";
			else if (jc && gap !== undefined) arr = `Arrangement.spacedBy(${dp(gap)}, Alignment.${jc === "Center" ? (col ? "CenterVertically" : "CenterHorizontally") : col ? "Bottom" : "End"})`;
			else if (jc) arr = `Arrangement.${jc}`;
			else if (gap !== undefined) arr = `Arrangement.spacedBy(${dp(gap)})`;
			if (arr) args.push(`${col ? "verticalArrangement" : "horizontalArrangement"} = ${arr}`);
			const al = (col ? ALIGN_H : ALIGN_V)[c["align-items"] ?? ""];
			if (al) args.push(`${col ? "horizontalAlignment" : "verticalAlignment"} = Alignment.${al}`);
			if (c["flex-wrap"]) notes.push("// TODO: wrap → FlowRow/FlowColumn");
		}
		const kids = (d.children ?? []).map((k) => emit(k, indent + 1, kind, def));
		const head = `${pad}${kind}(${args.length ? `\n${args.map((a) => `${pad}    ${a},`).join("\n")}\n${pad}` : ""})`;
		return kids.length ? `${head} {\n${kids.join("\n")}\n${pad}}` : `${head} {}`;
	};

	const body = emit(root, 1, undefined);
	const code = [...defined.values(), `@Composable\nfun ${name}() {\n${body}\n}\n`].join("\n");
	const imports = new Set(["androidx.compose.runtime.Composable"]);
	for (const [re, imp] of IMPORTS) if (re.test(code)) imports.add(imp);
	return { code, imports: [...imports].sort() };
}
