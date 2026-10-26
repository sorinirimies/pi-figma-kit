import { describe, expect, test } from "bun:test";
import { generate } from "../extensions/design/codegen.ts";
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
		expect(r.code).toContain("[gap:8px]");
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
