import { describe, expect, test } from "bun:test";
import { composeColor, generateCompose } from "../extensions/design/compose.ts";
import { simplify } from "../extensions/design/simplify.ts";
import { card, components, styles } from "./fixtures.ts";

describe("compose", () => {
	test("colors", () => {
		expect(composeColor("#ff8800")).toBe("Color(0xFFFF8800)");
		expect(composeColor("rgba(0, 0, 0, 0.5)")).toBe("Color(0x80000000)");
		expect(composeColor("linear-gradient(red, blue)")).toBeUndefined();
		expect(composeColor(undefined)).toBeUndefined();
	});
	test("card -> Column with modifiers, Text, Icon, Image", () => {
		const { code, imports } = generateCompose(simplify(card, { components, styles }), "MyCard");
		expect(code).toStartWith("@Composable\nfun MyCard() {\n    Column(");
		expect(code).toContain(".width(320.dp)");
		expect(code).toContain(".background(Color(0xFFFFFFFF), RoundedCornerShape(12.dp))");
		expect(code).toContain(".border(1.dp, Color(0x1A000000), RoundedCornerShape(12.dp))");
		expect(code).toContain(".clip(RoundedCornerShape(12.dp))");
		expect(code).toContain(".shadow(8.dp, RoundedCornerShape(12.dp))");
		expect(code).toContain(".padding(16.dp)");
		expect(code).toContain("verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically)");
		expect(code).toContain("horizontalAlignment = Alignment.CenterHorizontally");
		expect(code).toContain('text = "Hello <World>"');
		expect(code).toContain("fontSize = 20.sp");
		expect(code).toContain("fontWeight = FontWeight(700)");
		expect(code).toContain("textAlign = TextAlign.Center");
		expect(code).toContain("Icon(");
		expect(code).toContain("painterResource(R.drawable.icon)");
		expect(code).toContain("Image(");
		expect(code).toContain("R.drawable.abc123");
		expect(imports).toContain("androidx.compose.foundation.layout.Column");
		expect(imports).toContain("androidx.compose.material3.Icon");
		expect(imports).toContain("androidx.compose.ui.unit.sp");
		expect(imports).toContain("androidx.compose.foundation.shape.RoundedCornerShape");
	});
	test("row, box, absolute offset, gradient todo, wrap, escaping", () => {
		const n: any = {
			id: "1:1", name: "Row", type: "FRAME", layoutMode: "HORIZONTAL", itemSpacing: 4, primaryAxisAlignItems: "SPACE_BETWEEN", counterAxisAlignItems: "CENTER", layoutWrap: "WRAP",
			absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 }, layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED", opacity: 0.5, rotation: 0.5,
			fills: [{ type: "GRADIENT_LINEAR", gradientHandlePositions: [{ x: 0, y: 0 }, { x: 1, y: 1 }], gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }] }],
			children: [
				{ id: "1:2", name: "Free", type: "FRAME", absoluteBoundingBox: { x: 10, y: 20, width: 5, height: 5 }, children: [{ id: "1:3", name: "Cost", type: "TEXT", characters: "$5 \"x\"", style: { fontSize: 10, textDecoration: "UNDERLINE", italic: true, letterSpacing: 1, lineHeightPx: 12, textAlignHorizontal: "JUSTIFIED" }, layoutSizingHorizontal: "FILL", absoluteBoundingBox: { x: 12, y: 23, width: 5, height: 5 } }] },
				{ id: "1:4", name: "Fill", type: "RECTANGLE", layoutSizingHorizontal: "FILL", layoutSizingVertical: "FILL", absoluteBoundingBox: { x: 0, y: 0, width: 5, height: 5 }, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], cornerRadius: 0, effects: [{ type: "DROP_SHADOW", offset: { x: 0, y: 0 }, radius: 0, color: { r: 0, g: 0, b: 0 } }] },
				{ id: "1:5", name: "Dot", type: "ELLIPSE", absoluteBoundingBox: { x: 0, y: 0, width: 4, height: 4 }, fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }], layoutAlign: "STRETCH" },
			],
		};
		const { code } = generateCompose(simplify(n));
		expect(code).toContain("fun Row()");
		expect(code).toContain("horizontalArrangement = Arrangement.SpaceBetween");
		expect(code).toContain("verticalAlignment = Alignment.CenterVertically");
		expect(code).toContain("TODO: wrap");
		expect(code).toContain("TODO gradient");
		expect(code).toContain(".alpha(0.5f)");
		expect(code).toContain(".rotate(");
		expect(code).toContain(".offset(2.dp, 3.dp)");
		expect(code).toContain('text = "\\$5 \\"x\\""');
		expect(code).toContain("textDecoration = TextDecoration.Underline");
		expect(code).toContain("fontStyle = FontStyle.Italic");
		expect(code).toContain("textAlign = TextAlign.Justify");
		expect(code).toContain("weight(1f)");
		expect(code).toContain("CircleShape");
		expect(code).toContain("Box(");
	});
});
