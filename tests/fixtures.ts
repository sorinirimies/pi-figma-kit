export const card = {
	id: "1:2", name: "Card", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 8, paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
	primaryAxisAlignItems: "CENTER", counterAxisAlignItems: "CENTER", cornerRadius: 12, clipsContent: true,
	layoutSizingHorizontal: "FIXED", layoutSizingVertical: "HUG", absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 200 },
	fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
	strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 0.1 } }], strokeWeight: 1,
	effects: [{ type: "DROP_SHADOW", offset: { x: 0, y: 4 }, radius: 8, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } }],
	children: [
		{ id: "1:3", name: "Title", type: "TEXT", characters: "Hello <World>", layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG",
			absoluteBoundingBox: { x: 16, y: 16, width: 100, height: 24 },
			fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
			style: { fontFamily: "Inter", fontSize: 20, fontWeight: 700, lineHeightPx: 24, letterSpacing: 0, textAlignHorizontal: "CENTER", textAutoResize: "WIDTH_AND_HEIGHT" },
			characterStyleOverrides: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1], styleOverrideTable: { "1": { fontWeight: 400 } } },
		{ id: "1:4", name: "Icon", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 }, children: [{ id: "1:5", name: "Vec", type: "VECTOR" }] },
		{ id: "1:6", name: "Photo", type: "RECTANGLE", layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED", absoluteBoundingBox: { x: 16, y: 60, width: 288, height: 100 }, fills: [{ type: "IMAGE", imageRef: "abc123", scaleMode: "FILL" }] },
		{ id: "1:7", name: "Hidden", type: "RECTANGLE", visible: false },
		{ id: "1:8", name: "Btn", type: "INSTANCE", componentId: "9:9", absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 }, styles: { fill: "S:1" } },
	],
};
export const components = { "9:9": { name: "Button" } };
export const styles = { "S:1": { name: "Brand/Primary" } };

export function mockFetch(routes: Record<string, (url: URL, init?: RequestInit) => unknown>) {
	const calls: { url: URL; init?: RequestInit }[] = [];
	const fn = async (u: string, init?: RequestInit) => {
		const url = new URL(u);
		calls.push({ url, init });
		const key = Object.keys(routes).filter((k) => url.pathname === k || url.pathname.startsWith(k)).sort((a, b) => b.length - a.length)[0];
		if (!key) return new Response(JSON.stringify({ err: "nope" }), { status: 404 });
		const r = routes[key]!(url, init);
		if (r instanceof Response) return r;
		return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
	};
	return { fn, calls };
}
