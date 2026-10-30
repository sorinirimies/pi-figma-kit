/** Deterministic DNode -> markup scaffolds (HTML+CSS, React, Tailwind). The model refines them to project conventions. */
import type { Css } from "./css.ts";
import { type DNode, withVars } from "./simplify.ts";

export type Framework = "html" | "react" | "tailwind";
export interface GenOptions {
	framework: Framework;
	/** Directory prefix used in <img src> for svg assets. */
	assetsDir?: string;
	componentName?: string;
}

export const slug = (s: string): string =>
	s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(\d)/, "n$1") || "node";
export const pascal = (s: string): string => slug(s).split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join("") || "Component";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const jsxText = (s: string) => esc(s).replace(/[{}]/g, (c) => `{'${c}'}`);

/** Unique readable class per node. */
function namer() {
	const used = new Map<string, number>();
	return (name: string) => {
		const b = slug(name);
		const k = used.get(b) ?? 0;
		used.set(b, k + 1);
		return k ? `${b}-${k + 1}` : b;
	};
}

const TW: Record<string, string> = {
	"display:flex": "flex",
	"flex-direction:column": "flex-col",
	"flex-direction:row": "flex-row",
	"flex-wrap:wrap": "flex-wrap",
	"position:absolute": "absolute",
	"position:relative": "relative",
	"overflow:hidden": "overflow-hidden",
	"justify-content:center": "justify-center",
	"justify-content:space-between": "justify-between",
	"justify-content:flex-end": "justify-end",
	"align-items:center": "items-center",
	"align-items:flex-end": "items-end",
	"align-items:flex-start": "items-start",
	"align-self:stretch": "self-stretch",
	"text-align:center": "text-center",
	"text-align:right": "text-right",
	"text-transform:uppercase": "uppercase",
	"font-style:italic": "italic",
	"border-radius:50%": "rounded-full",
};
/** Tailwind default spacing scale: px -> key. */
const SPACE: Record<string, string> = Object.fromEntries(
	[[0, "0"], [1, "px"], ...[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96].map((k) => [k * 4, String(k)])].map(([v, k]) => [`${v}px`, String(k)]),
);
const RADIUS: Record<string, string> = { "0px": "rounded-none", "2px": "rounded-sm", "4px": "rounded", "6px": "rounded-md", "8px": "rounded-lg", "12px": "rounded-xl", "16px": "rounded-2xl", "24px": "rounded-3xl", "50%": "rounded-full" };
const WEIGHT: Record<string, string> = { "100": "thin", "200": "extralight", "300": "light", "400": "normal", "500": "medium", "600": "semibold", "700": "bold", "800": "extrabold", "900": "black" };
const isColor = (v: string) => /^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i.test(v);
const arb = (v: string) => v.replace(/\s+/g, "_").replace(/'/g, "");

/** One scale step (`p-4`) or a typed arbitrary value (`p-[13px]`). */
const step = (prefix: string, v: string) => (SPACE[v] ? `${prefix}-${SPACE[v]}` : `${prefix}-[${arb(v)}]`);

/** Utility classes for one declaration; undefined = no idiomatic form, use an arbitrary property. */
function twUtil(k: string, v: string, css: Css): string | undefined {
	if (TW[`${k}:${v}`]) return TW[`${k}:${v}`];
	if (v.includes("var(")) return undefined; // tokens: keep the declaration explicit
	const px1 = /^-?[\d.]+px$/.test(v);
	switch (k) {
		case "gap":
		case "width":
		case "height":
		case "min-width":
		case "min-height":
		case "max-width":
		case "max-height":
		case "left":
		case "right":
		case "top":
		case "bottom": {
			if (!px1 && !/^[\d.]+%$/.test(v)) return undefined;
			const pre = { gap: "gap", width: "w", height: "h", "min-width": "min-w", "min-height": "min-h", "max-width": "max-w", "max-height": "max-h", left: "left", right: "right", top: "top", bottom: "bottom" }[k];
			return px1 ? step(pre, v) : `${pre}-[${v}]`;
		}
		case "padding": {
			const p = v.split(" ");
			if (!p.every((x) => /^[\d.]+px$/.test(x))) return undefined;
			if (p.length === 1) return step("p", p[0]!);
			if (p.length === 2) return `${step("py", p[0]!)} ${step("px", p[1]!)}`;
			return `${step("pt", p[0]!)} ${step("pr", p[1]!)} ${step("pb", p[2]!)} ${step("pl", p[3]!)}`;
		}
		case "border-radius":
			return RADIUS[v] ?? (px1 ? `rounded-[${v}]` : undefined);
		case "font-weight":
			return WEIGHT[v] ? `font-${WEIGHT[v]}` : undefined;
		case "font-size":
			return px1 ? `text-[${v}]` : undefined;
		case "line-height":
			return px1 ? `leading-[${v}]` : undefined;
		case "letter-spacing":
			return px1 ? `tracking-[${v}]` : undefined;
		case "color":
			return isColor(v) ? `text-[${arb(v)}]` : undefined;
		case "background":
			return isColor(v) ? `bg-[${arb(v)}]` : undefined;
		case "opacity": {
			const o = Math.round(Number(v) * 100);
			return o % 5 === 0 && o >= 0 && o <= 100 && !css.transition ? `opacity-${o}` : undefined;
		}
		case "flex":
			return v === "1 1 0" ? "flex-1" : undefined;
		default:
			return undefined;
	}
}

const twClass = (css: Css) => Object.entries(css).map(([k, v]) => twUtil(k, v, css) ?? `[${k}:${arb(v)}]`).join(" ");

/** Semantic element for a node, from its name, component and text style. */
export function semanticTag(d: DNode, inInteractive: boolean): { tag: string; attrs: string; interactive: boolean } {
	const label = `${d.component ?? ""} ${d.name}`.toLowerCase();
	if (d.text !== undefined) {
		const style = `${d.styles?.text ?? ""} ${d.name}`.toLowerCase();
		const h = /\bh([1-6])\b/.exec(style);
		if (h) return { tag: `h${h[1]}`, attrs: "", interactive: false };
		if (/\b(heading|headline|title|display)\b/.test(style)) return { tag: "h2", attrs: "", interactive: false };
		return { tag: "p", attrs: "", interactive: false };
	}
	if (!inInteractive && /\b(button|btn|cta)\b/.test(label)) return { tag: "button", attrs: ' type="button"', interactive: true };
	if (!inInteractive && /\blink\b/.test(label)) return { tag: "a", attrs: ' href="#"', interactive: true };
	for (const t of ["nav", "header", "footer"] as const) if (new RegExp(`\\b${t === "nav" ? "(nav|navbar|navigation)" : t}\\b`).test(label)) return { tag: t, attrs: "", interactive: false };
	return { tag: "div", attrs: "", interactive: false };
}

/** Undo browser button/link styling so the design's own CSS is what you see (Tailwind's preflight does this already). */
const RESET: Record<string, Css> = {
	button: { appearance: "none", border: "0", padding: "0", background: "none", font: "inherit", color: "inherit", "text-align": "inherit", cursor: "pointer" },
	a: { color: "inherit", "text-decoration": "none" },
};

const cssBlock = (sel: string, css: Css) => `.${sel} {\n${Object.entries(css).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;

/** Replace the figma-image pseudo-URL with a real-looking asset path. */
const fixImg = (css: Css, dir: string): Css =>
	Object.fromEntries(Object.entries(css).map(([k, v]) => [k, v.replace(/url\(figma-image:([^)]+)\)/g, `url(${dir}/$1.png)`)]));

export function generate(root: DNode, o: GenOptions): { code: string; css?: string } {
	const dir = o.assetsDir ?? "./assets";
	const name = namer();
	const sheets: string[] = [];

	const emit = (d: DNode, indent: number, inInteractive = false): string => {
		const pad = "  ".repeat(indent);
		const sem = d.asset ? { tag: "img", attrs: "", interactive: false } : semanticTag(d, inInteractive);
		const own = fixImg(withVars(d), dir);
		const css = o.framework !== "tailwind" && RESET[sem.tag] ? { ...RESET[sem.tag], ...own } : own;
		const cls = name(d.name);
		const attrs = ((): string => {
			if (o.framework === "tailwind") return ` className="${twClass(css)}"`;
			if (o.framework === "react") return ` className="${cls}"`;
			return ` class="${cls}"`;
		})();
		if (o.framework !== "tailwind" && Object.keys(css).length) sheets.push(cssBlock(cls, css));

		if (d.asset) {
			const src = `${dir}/${slug(d.name)}.svg`;
			return `${pad}<img${attrs} src="${src}" alt="${esc(d.name)}" />`;
		}
		const { tag } = sem;
		const open = `${tag}${attrs}${sem.attrs}`;
		if (d.text !== undefined) {
			const t = o.framework === "html" ? esc : jsxText;
			const inner = d.runs
				? d.runs.map((r) => {
						if (!Object.keys(r.css).length) return t(r.text);
						const c = name(`${d.name}-run`);
						if (o.framework === "tailwind") return `<span className="${twClass(r.css)}">${t(r.text)}</span>`;
						sheets.push(cssBlock(c, r.css));
						return `<span ${o.framework === "html" ? "class" : "className"}="${c}">${t(r.text)}</span>`;
					}).join("")
				: t(d.text).replace(/\n/g, o.framework === "html" ? "<br>" : "<br />");
			return `${pad}<${open}>${inner}</${tag}>`;
		}
		const kids = (d.children ?? []).map((c) => emit(c, indent + 1, inInteractive || sem.interactive));
		if (!kids.length) return `${pad}<${open}></${tag}>`;
		return `${pad}<${open}>\n${kids.join("\n")}\n${pad}</${tag}>`;
	};

	const body = emit(root, o.framework === "react" || o.framework === "tailwind" ? 2 : 0);
	const stylesheet = sheets.join("\n\n");
	if (o.framework === "html") return { code: body, css: stylesheet };
	const comp = o.componentName ?? pascal(root.name);
	const code = `export function ${comp}() {\n  return (\n${body}\n  );\n}\n`;
	return { code, css: o.framework === "react" ? stylesheet : undefined };
}
