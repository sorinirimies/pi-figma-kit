/** Figma variables / styles -> design-token output (CSS custom properties, JSON, Tailwind theme). */
import { type FNode, color, cssString, fillCss, n, textCss } from "./css.ts";

export interface Token {
	name: string; // "brand/primary"
	type: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN" | "STYLE";
	/** value per mode name; alias values are { alias: "other/name" } */
	values: Record<string, string | { alias: string }>;
}
export interface TokenSet {
	modes: string[];
	tokens: Token[];
}

export const cssVar = (name: string): string => "--" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** `meta` from GET /v1/files/:key/variables/local (or published). */
export function fromVariables(meta: FNode, opts: { unit?: string; collection?: string } = {}): TokenSet {
	const vars: Record<string, FNode> = meta?.variables ?? {};
	const cols: Record<string, FNode> = meta?.variableCollections ?? {};
	const byId = (id: string) => vars[id];
	const modes: string[] = [];
	const tokens: Token[] = [];
	const unit = opts.unit ?? "px";
	for (const c of Object.values(cols)) {
		if (opts.collection && !c.name.toLowerCase().includes(opts.collection.toLowerCase())) continue;
		const modeName: Record<string, string> = Object.fromEntries((c.modes ?? []).map((m: FNode) => [m.modeId, m.name]));
		for (const m of Object.values(modeName)) if (!modes.includes(m)) modes.push(m);
		for (const vid of c.variableIds ?? []) {
			const v = vars[vid];
			if (!v || v.remote) continue;
			const values: Token["values"] = {};
			for (const [mid, raw] of Object.entries<any>(v.valuesByMode ?? {})) {
				const mn = modeName[mid] ?? mid;
				if (raw && typeof raw === "object" && raw.type === "VARIABLE_ALIAS") values[mn] = { alias: byId(raw.id)?.name ?? raw.id };
				else if (raw && typeof raw === "object" && "r" in raw) values[mn] = color(raw);
				else if (typeof raw === "number") values[mn] = `${n(raw)}${unit && v.resolvedType === "FLOAT" ? unit : ""}`;
				else values[mn] = String(raw);
			}
			tokens.push({ name: v.name, type: v.resolvedType, values });
		}
	}
	return { modes, tokens };
}

/** Styles resolved to tokens (fallback when variables are unavailable). `nodes` are the style source nodes. */
export function fromStyles(styles: { node_id: string; style_type: string; name: string }[], nodes: Record<string, FNode>): TokenSet {
	const tokens: Token[] = [];
	for (const s of styles) {
		const d = nodes[s.node_id];
		if (!d) continue;
		let v = "";
		if (s.style_type === "FILL") v = fillCss(d.fills).background ?? "";
		else if (s.style_type === "TEXT") v = cssString(textCss(d.style));
		else if (s.style_type === "EFFECT") v = JSON.stringify(d.effects ?? []);
		if (v) tokens.push({ name: s.name, type: s.style_type === "FILL" ? "COLOR" : "STYLE", values: { Default: v } });
	}
	return { modes: ["Default"], tokens };
}

const resolve = (v: Token["values"][string]): string => (typeof v === "string" ? v : `var(${cssVar(v.alias)})`);

export function toCss(set: TokenSet, selector = ":root"): string {
	const [base, ...others] = set.modes.length ? set.modes : ["Default"];
	const block = (sel: string, mode: string, onlyDiff: boolean) => {
		const lines = set.tokens
			.filter((t) => t.values[mode] !== undefined && (!onlyDiff || JSON.stringify(t.values[mode]) !== JSON.stringify(t.values[base!])))
			.map((t) => `  ${cssVar(t.name)}: ${t.type === "STRING" ? JSON.stringify(resolve(t.values[mode]!)) : resolve(t.values[mode]!)};`);
		return lines.length ? `${sel} {\n${lines.join("\n")}\n}` : "";
	};
	return [block(selector, base!, false), ...others.map((m) => block(`[data-mode="${m}"]`, m, true))].filter(Boolean).join("\n\n") + "\n";
}

export function toJson(set: TokenSet): string {
	const out: Record<string, any> = {};
	for (const t of set.tokens) {
		const path = t.name.split("/");
		let o = out;
		for (const p of path.slice(0, -1)) o = o[p] = typeof o[p] === "object" && o[p] ? o[p] : {};
		o[path.at(-1)!] = Object.fromEntries(Object.entries(t.values).map(([m, v]) => [m, typeof v === "string" ? v : `{${v.alias.replace(/\//g, ".")}}`]));
		(o[path.at(-1)!] as any).$type = t.type.toLowerCase();
	}
	return JSON.stringify(out, null, 2) + "\n";
}

/** Tailwind theme.extend referencing the CSS variables (colors + spacing/size numbers). */
export function toTailwind(set: TokenSet): string {
	const colors: Record<string, string> = {};
	const spacing: Record<string, string> = {};
	for (const t of set.tokens) {
		const key = t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
		if (t.type === "COLOR") colors[key] = `var(${cssVar(t.name)})`;
		else if (t.type === "FLOAT") spacing[key] = `var(${cssVar(t.name)})`;
	}
	return `// tailwind.config: pair with the CSS variables from format=css\nexport default {\n  theme: { extend: { colors: ${JSON.stringify(colors, null, 2)}, spacing: ${JSON.stringify(spacing, null, 2)} } },\n};\n`;
}
