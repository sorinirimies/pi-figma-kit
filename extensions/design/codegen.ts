/** Deterministic DNode -> markup scaffolds (HTML+CSS, React, Tailwind). The model refines them to project conventions. */
import type { Css } from "./css.ts";
import type { DNode } from "./simplify.ts";

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
const twClass = (css: Css) =>
	Object.entries(css).map(([k, v]) => TW[`${k}:${v}`] ?? `[${k}:${v.replace(/\s+/g, "_").replace(/'/g, "")}]`).join(" ");

const cssBlock = (sel: string, css: Css) => `.${sel} {\n${Object.entries(css).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;

/** Replace the figma-image pseudo-URL with a real-looking asset path. */
const fixImg = (css: Css, dir: string): Css =>
	Object.fromEntries(Object.entries(css).map(([k, v]) => [k, v.replace(/url\(figma-image:([^)]+)\)/g, `url(${dir}/$1.png)`)]));

export function generate(root: DNode, o: GenOptions): { code: string; css?: string } {
	const dir = o.assetsDir ?? "./assets";
	const name = namer();
	const sheets: string[] = [];

	const emit = (d: DNode, indent: number): string => {
		const pad = "  ".repeat(indent);
		const css = fixImg(d.css, dir);
		const cls = name(d.name);
		const attrs = ((): string => {
			if (o.framework === "tailwind") return ` className="${twClass(css)}"`;
			if (o.framework === "react") return ` className="${cls}"`;
			return ` class="${cls}"`;
		})();
		if (o.framework !== "tailwind" && Object.keys(css).length) sheets.push(cssBlock(cls, css));

		const tag = d.type === "TEXT" ? "p" : "div";
		if (d.asset) {
			const src = `${dir}/${slug(d.name)}.svg`;
			return `${pad}<img${attrs} src="${src}" alt="${esc(d.name)}" />`;
		}
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
			return `${pad}<${tag}${attrs}>${inner}</${tag}>`;
		}
		const kids = (d.children ?? []).map((c) => emit(c, indent + 1));
		if (!kids.length) return `${pad}<${tag}${attrs}></${tag}>`;
		return `${pad}<${tag}${attrs}>\n${kids.join("\n")}\n${pad}</${tag}>`;
	};

	const body = emit(root, o.framework === "react" || o.framework === "tailwind" ? 2 : 0);
	const stylesheet = sheets.join("\n\n");
	if (o.framework === "html") return { code: body, css: stylesheet };
	const comp = o.componentName ?? pascal(root.name);
	const code = `export function ${comp}() {\n  return (\n${body}\n  );\n}\n`;
	return { code, css: o.framework === "react" ? stylesheet : undefined };
}
