import { describe, expect, test } from "bun:test";
import { generate } from "../extensions/design/codegen.ts";
import { generateCompose } from "../extensions/design/compose.ts";
import { color, fillCss, nodeCss, paintLayer } from "../extensions/design/css.ts";
import { collectAssets, countNodes, outline, simplify } from "../extensions/design/simplify.ts";
import { card, components, styles } from "./fixtures.ts";

const tree = () => simplify(card, { components, styles });

describe("css", () => {
	test("colors", () => {
		expect(color({ r: 1, g: 0, b: 0 })).toBe("#ff0000");
		expect(color({ r: 0, g: 0, b: 0, a: 0.5 })).toBe("rgba(0, 0, 0, 0.5)");
	});
	test("gradient angle and multiple fills", () => {
		const g = { type: "GRADIENT_LINEAR", gradientHandlePositions: [{ x: 0, y: 0 }, { x: 1, y: 0 }], gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }] };
		expect(paintLayer(g)).toBe("linear-gradient(90deg, #000000 0%, #ffffff 100%)");
		const css = fillCss([{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }, g]);
		expect(css.background).toStartWith("linear-gradient(90deg");
		expect(css.background).toContain("linear-gradient(#ffffff, #ffffff)");
	});
	test("auto layout, shadow, border, radius", () => {
		const css = nodeCss(card);
		expect(css).toMatchObject({ display: "flex", "flex-direction": "column", gap: "8px", padding: "16px", "justify-content": "center", "align-items": "center", "border-radius": "12px", overflow: "hidden", border: "1px solid rgba(0, 0, 0, 0.1)", width: "320px" });
		expect(css.height).toBeUndefined();
		expect(css["box-shadow"]).toBe("0px 4px 8px 0px rgba(0, 0, 0, 0.25)");
	});
	test("absolute child in a non-auto-layout parent; fill sizing", () => {
		const parent = { absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 }, children: [1] };
		expect(nodeCss({ type: "RECTANGLE", absoluteBoundingBox: { x: 15, y: 20, width: 5, height: 5 } }, { parent })).toMatchObject({ position: "absolute", left: "5px", top: "10px" });
		const h = { layoutMode: "HORIZONTAL" };
		expect(nodeCss({ type: "RECTANGLE", layoutSizingHorizontal: "FILL", absoluteBoundingBox: { x: 0, y: 0, width: 5, height: 5 } }, { parent: h }).flex).toBe("1 1 0");
	});
});

describe("simplify", () => {
	test("tree shape", () => {
		const t = tree();
		expect(t.children!.map((c) => c.name)).toEqual(["Title", "Icon", "Photo", "Btn"]); // hidden dropped
		const [title, icon, photo, btn] = t.children!;
		expect(title!.text).toBe("Hello <World>");
		expect(title!.css["font-weight"]).toBe("700");
		expect(title!.runs!.map((r) => r.text)).toEqual(["Hello", " <Wor", "ld>"]);
		expect(icon!.asset).toBe("svg");
		expect(photo!.imageRef).toBe("abc123");
		expect(btn!.component).toBe("Button");
		expect(btn!.styles).toEqual({ fill: "Brand/Primary" });
		expect(countNodes(t)).toBe(5);
		const a = collectAssets(t);
		expect(a.icons.length).toBe(1);
		expect(a.images.length).toBe(1);
	});
	test("mixed run overrides", () => {
		const runs = tree().children![0]!.runs!;
		expect(runs.length).toBe(3);
		expect(runs[1]!.css["font-weight"]).toBe("400");
		expect(runs[2]!.css["font-weight"]).toBeUndefined(); // trailing chars without override = base style
	});
	test("depth and maxNodes truncate", () => {
		expect(simplify(card, { depth: 0 }).truncated).toBe(true);
		const t = simplify(card, { maxNodes: 2 });
		expect(t.truncated).toBe(true);
		expect(outline(t)).toContain("truncated");
	});
	test("outline", () => {
		const o = outline(tree());
		expect(o).toContain('FRAME "Card" #1:2');
		expect(o).toContain("<Button>");
		expect(o).toContain("[svg-asset]");
		expect(o).toContain("[image:abc123]");
	});
});

describe("codegen", () => {
	test("html", () => {
		const r = generate(tree(), { framework: "html" });
		expect(r.code).toContain('<div class="card">');
		expect(r.code).toContain("&lt;Wor");
		expect(r.code).toContain('<img class="icon" src="./assets/icon.svg"');
		expect(r.css).toContain(".card {");
		expect(r.css).toContain("url(./assets/abc123.png)");
	});
	test("react", () => {
		const r = generate(tree(), { framework: "react", componentName: "MyCard" });
		expect(r.code).toStartWith("export function MyCard()");
		expect(r.code).toContain('className="card"');
		expect(r.css).toContain(".card");
	});
	test("tailwind", () => {
		const r = generate(tree(), { framework: "tailwind" });
		expect(r.css).toBeUndefined();
		expect(r.code).toContain("flex flex-col");
		expect(r.code).toContain("gap-2 p-4 justify-center items-center bg-[#ffffff] rounded-xl");
		expect(r.code).toContain("[border:1px_solid_rgba(0,_0,_0,_0.1)]");
		expect(r.code).toContain('<button className="w-[50px] h-5" type="button"></button>');
	});
});

describe("css extras", () => {
	test("gradients, image fill, strokes, effects, transforms", () => {
		const stops = [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }];
		expect(paintLayer({ type: "GRADIENT_RADIAL", gradientStops: stops })).toStartWith("radial-gradient(circle");
		expect(paintLayer({ type: "GRADIENT_ANGULAR", gradientStops: stops })).toStartWith("conic-gradient");
		expect(paintLayer({ type: "VIDEO" })).toBeUndefined();
		expect(fillCss([{ type: "IMAGE", imageRef: "r", scaleMode: "FIT" }])["background-size"]).toBe("contain");
		expect(fillCss([{ type: "IMAGE", imageRef: "r", scaleMode: "TILE" }])["background-size"]).toBe("auto");
		expect(fillCss([{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, visible: false }])).toEqual({});
		const css = nodeCss({
			type: "ELLIPSE", absoluteBoundingBox: { x: 0, y: 0, width: 4, height: 4 }, opacity: 0.5, rotation: Math.PI / 2, blendMode: "MULTIPLY", visible: false,
			strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], individualStrokeWeights: { top: 1, right: 0, bottom: 2, left: 0 }, strokeDashes: [2],
			effects: [{ type: "LAYER_BLUR", radius: 8 }, { type: "BACKGROUND_BLUR", radius: 4 }, { type: "INNER_SHADOW", radius: 1, color: { r: 0, g: 0, b: 0 } }],
			rectangleCornerRadii: [1, 2, 3, 4],
		});
		expect(css).toMatchObject({ "border-top": "1px dashed #000000", "border-bottom": "2px dashed #000000", filter: "blur(4px)", "backdrop-filter": "blur(2px)", opacity: "0.5", "mix-blend-mode": "multiply", display: "none", "border-radius": "1px 2px 3px 4px", transform: "rotate(-90deg)" });
		expect(css["box-shadow"]).toStartWith("inset");
		expect(nodeCss({ type: "RECTANGLE", strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], strokeWeight: 2, strokeAlign: "OUTSIDE", cornerRadius: 3 }).outline).toBe("2px solid #000000");
	});
});

describe("codegen extras", () => {
	test("empty div, tailwind runs, braces in react text", () => {
		const t: any = { id: "1", name: "Root 1", type: "FRAME", css: {}, children: [
			{ id: "2", name: "Empty", type: "FRAME", css: { "border-radius": "50%" } },
			{ id: "3", name: "Rich", type: "TEXT", css: {}, text: "a{b}\nc", runs: [{ text: "a", css: { "font-weight": "700" } }, { text: "{b}", css: {} }] },
		] };
		const tw = generate(t, { framework: "tailwind" }).code;
		expect(tw).toContain('<div className="rounded-full"></div>');
		expect(tw).toContain('<span className="font-bold">a</span>');
		const r = generate(t, { framework: "react" });
		expect(r.code).toContain("{'{'}b{'}'}");
		expect(r.css).toContain("rich-run");
		const h = generate({ ...t, children: [{ id: "3", name: "T", type: "TEXT", css: {}, text: "a\nb" }] }, { framework: "html" });
		expect(h.code).toContain("a<br>b");
	});
});

describe("codegen quality", () => {
	const D = (over: any): any => ({ id: "1", name: "N", type: "FRAME", css: {}, ...over });
	test("tailwind: scale steps, typed arbitrary values, tokens stay explicit", () => {
		const tw = (css: Record<string, string>) => generate(D({ css }), { framework: "tailwind" }).code.match(/className="([^"]*)"/)![1];
		expect(tw({ gap: "16px", padding: "8px 24px", width: "40px", height: "13px" })).toBe("gap-4 py-2 px-6 w-10 h-[13px]");
		expect(tw({ padding: "1px 2px 3px 4px" })).toBe("pt-px pr-0.5 pb-[3px] pl-1");
		expect(tw({ padding: "4px", "min-width": "0px", "max-height": "50%", left: "calc(50% - 4px)", top: "10%", right: "12px", bottom: "-4px" })).toBe("p-1 min-w-0 max-h-[50%] [left:calc(50%_-_4px)] top-[10%] right-3 bottom-[-4px]");
		expect(tw({ padding: "var(--s, 4px) 2px" })).toBe("[padding:var(--s,_4px)_2px]");
		expect(tw({ "border-radius": "8px", "font-weight": "600", "font-size": "14px", "line-height": "20px", "letter-spacing": "0.5px" })).toBe("rounded-lg font-semibold text-[14px] leading-[20px] tracking-[0.5px]");
		expect(tw({ "border-radius": "10px", "font-weight": "450", "font-size": "1em", "line-height": "1.2", "letter-spacing": "1em" })).toBe("rounded-[10px] [font-weight:450] [font-size:1em] [line-height:1.2] [letter-spacing:1em]");
		expect(tw({ "border-radius": "1px 2px 3px 4px", gap: "auto" })).toBe("[border-radius:1px_2px_3px_4px] [gap:auto]");
		expect(tw({ color: "rgba(0, 0, 0, 0.5)", background: "linear-gradient(red, blue)" })).toBe("text-[rgba(0,_0,_0,_0.5)] [background:linear-gradient(red,_blue)]");
		expect(tw({ background: "var(--brand, #fff)", color: "currentColor" })).toBe("[background:var(--brand,_#fff)] [color:currentColor]");
		expect(tw({ opacity: "0.5", flex: "1 1 0" })).toBe("opacity-50 flex-1");
		expect(tw({ opacity: "0.33", flex: "0 0 auto" })).toBe("[opacity:0.33] [flex:0_0_auto]");
		expect(tw({ opacity: "0.5", transition: "x" })).toBe("[opacity:0.5] [transition:x]");
	});

	test("semantic tags: headings, buttons, links, landmarks; nothing interactive nested", () => {
		const tree = D({ name: "Page", children: [
			D({ name: "Top Nav", children: [D({ name: "Home link", children: [D({ name: "Inner button" })] })] }),
			D({ name: "Header" }),
			D({ name: "Site Footer" }),
			D({ name: "Primary", component: "Button/Large", children: [D({ name: "Label", type: "TEXT", text: "Go" })] }),
			D({ name: "Copy", type: "TEXT", text: "a", styles: { text: "Heading/H3" } }),
			D({ name: "Headline", type: "TEXT", text: "b" }),
			D({ name: "Body", type: "TEXT", text: "c", styles: { text: "Body/M" } }),
		] });
		const html = generate(tree, { framework: "html" });
		expect(html.code).toContain('<nav class="top-nav">');
		expect(html.code).toContain('<a class="home-link" href="#">');
		expect(html.code).toContain('<div class="inner-button"></div>'); // no <button> inside <a>
		expect(html.code).toContain('<header class="header">');
		expect(html.code).toContain('<footer class="site-footer">');
		expect(html.code).toContain('<button class="primary" type="button">');
		expect(html.code).toContain('<h3 class="copy">a</h3>');
		expect(html.code).toContain('<h2 class="headline">b</h2>');
		expect(html.code).toContain('<p class="body">c</p>');
		expect(html.css).toContain(".primary {\n  appearance: none;");
		expect(html.css).toContain(".home-link {\n  color: inherit;");
		expect(generate(tree, { framework: "tailwind" }).code).toContain('<button className="" type="button">'); // preflight resets
	});

	test("gradients use handle positions", () => {
		const stops = [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }];
		const h = [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0.5, y: 0.75 }];
		expect(paintLayer({ type: "GRADIENT_RADIAL", gradientStops: stops, gradientHandlePositions: h })).toBe("radial-gradient(ellipse 50% 25% at 50% 50%, #000000 0%, #ffffff 100%)");
		expect(paintLayer({ type: "GRADIENT_DIAMOND", gradientStops: stops, gradientHandlePositions: h })).toStartWith("radial-gradient(ellipse 50% 25%");
		expect(paintLayer({ type: "GRADIENT_ANGULAR", gradientStops: stops, gradientHandlePositions: h })).toBe("conic-gradient(from 90deg at 50% 50%, #000000 0%, #ffffff 100%)");
		expect(paintLayer({ type: "GRADIENT_ANGULAR", gradientStops: stops, gradientHandlePositions: [{ x: 0, y: 0 }, { x: 0, y: -1 }] })).toStartWith("conic-gradient(from 0deg at 0% 0%");
	});

	test("constraints anchor absolute children", () => {
		const parent = { type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 } };
		const at = (horizontal: string, vertical: string) =>
			nodeCss({ type: "RECTANGLE", constraints: { horizontal, vertical }, absoluteBoundingBox: { x: 20, y: 10, width: 40, height: 30 } }, { parent });
		expect(at("LEFT", "TOP")).toMatchObject({ position: "absolute", left: "20px", top: "10px", width: "40px", height: "30px" });
		expect(at("RIGHT", "BOTTOM")).toMatchObject({ right: "140px", bottom: "60px" });
		const stretch = at("LEFT_RIGHT", "TOP_BOTTOM");
		expect(stretch).toMatchObject({ left: "20px", right: "140px", top: "10px", bottom: "60px" });
		expect(stretch.width).toBeUndefined();
		expect(stretch.height).toBeUndefined();
		expect(at("CENTER", "CENTER")).toMatchObject({ left: "calc(50% - 80px)", top: "calc(50% - 40px)" });
		expect(nodeCss({ type: "RECTANGLE", constraints: { horizontal: "CENTER", vertical: "CENTER" }, absoluteBoundingBox: { x: 130, y: 50, width: 4, height: 4 } }, { parent })).toMatchObject({ left: "calc(50% + 30px)", top: "50%" });
		expect(at("SCALE", "SCALE")).toMatchObject({ left: "10%", width: "20%", top: "10%", height: "30%" });
		const flat = nodeCss({ type: "RECTANGLE", constraints: { horizontal: "SCALE" }, absoluteBoundingBox: { x: 5, y: 0, width: 0, height: 0 } }, { parent: { type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 0 } } });
		expect(flat.left).toBe("5px");
	});

	test("compose: constrained positions get a TODO instead of a wrong offset", () => {
		const t = D({ name: "Root", css: { width: "10px" }, children: [D({ name: "Pin", css: { position: "absolute", right: "4px", top: "2px" } }), D({ name: "At", css: { position: "absolute", left: "1px", top: "2px" } })] });
		const k = generateCompose(t).code;
		expect(k).toContain("// TODO: constrained position (right: 4px, top: 2px)");
		expect(k).toContain("offset(1.dp, 2.dp)");
	});
});
