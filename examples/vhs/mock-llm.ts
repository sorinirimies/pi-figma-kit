/**
 * A scripted OpenAI-compatible model for the demos (no network, no API key, no real model).
 * It reads the last user message, picks one figma_* tool call, and after the tool result comes back
 * it answers with a short canned summary, so the recordings show real tool calls on the fake file.
 *
 *   bun examples/vhs/mock-llm.ts [port]      (default 8989)
 */
const port = Number(process.argv[2] ?? 8989);
const KEY = "AcMeApp0Kit1";
const URL_ = `https://www.figma.com/design/${KEY}/Acme-Mobile`;

type Call = { name: string; args: Record<string, unknown> };
function plan(prompt: string): Call | undefined {
	const p = prompt.toLowerCase();
	if (p.includes("selected") || p.includes("selection")) return { name: "figma_desktop_selection", args: { framework: "react" } };
	if (p.includes("tokens")) return { name: "figma_export_tokens", args: { file: URL_, format: "css" } };
	if (p.includes("compose")) return { name: "figma_generate_code", args: { file: `${URL_}?node-id=1-1`, framework: "compose", component_name: "WelcomeScreen" } };
	if (p.includes("tailwind")) return { name: "figma_generate_code", args: { file: `${URL_}?node-id=2-1`, framework: "tailwind" } };
	if (p.includes("flow")) return { name: "figma_get_prototype_flows", args: { file: URL_ } };
	if (p.includes("comment")) return { name: "figma_get_comments", args: { file: URL_ } };
	if (p.includes("explore") || p.includes("structure")) return { name: "figma_get_file_structure", args: { file: URL_ } };
	if (p.includes("figma_get_design_context") || p.includes("design context") || p.includes("inspect")) return { name: "figma_get_design_context", args: { file: `${URL_}?node-id=1-1` } };
	return undefined;
}
const SUMMARY: Record<string, string> = {
	figma_get_file_structure: "Acme Mobile has two pages: Onboarding (Welcome, Profile card) and Components (Button).",
	figma_get_design_context: "Welcome is a 360×780 auto-layout column: hero image, title + subtitle, and two Button instances.",
	figma_generate_code: "Here is the scaffold. Colors and spacing match Figma; swap in your own components where it makes sense.",
	figma_export_tokens: "Exported 6 tokens, with a Dark mode override block and aliases as var().",
	figma_get_prototype_flows: "One flow, First run, starting at Welcome; the primary button navigates to Profile card.",
	figma_get_comments: "One open thread from Jon about the hero height; Mia answered: 360px minimum.",
	figma_desktop_selection: "That is the frame you have selected in Figma right now, with its Code Connect mapping.",
};

const sse = (delta: object, finish: string | null = null, usage?: object) =>
	`data: ${JSON.stringify({ id: "demo", object: "chat.completion.chunk", created: 0, model: "demo-model", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
const USAGE = { prompt_tokens: 3_200, completion_tokens: 160, total_tokens: 3_360 };

Bun.serve({
	port,
	hostname: "127.0.0.1",
	idleTimeout: 60,
	async fetch(req) {
		const url = new URL(req.url);
		if (req.method === "GET" && url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "demo-model", object: "model" }] });
		if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
		const body: any = await req.json().catch(() => ({}));
		const msgs: any[] = body.messages ?? [];
		const last = msgs.at(-1);
		const lastUser = [...msgs].reverse().find((m) => m.role === "user");
		const userText = typeof lastUser?.content === "string" ? lastUser.content : (lastUser?.content ?? []).map((c: any) => c.text ?? "").join(" ");
		let call: Call | undefined;
		let reply = "Demo model: try /figma, or ask me to explore the file, generate Compose code, export tokens or read comments.";
		if (last?.role === "tool") {
			const prior = [...msgs].reverse().find((m) => m.role === "assistant" && m.tool_calls)?.tool_calls?.[0]?.function?.name;
			reply = SUMMARY[prior] ?? "Done.";
		} else call = plan(userText);
		const enc = new TextEncoder();
		const stream = new ReadableStream({
			async start(c) {
				const send = (s: string) => c.enqueue(enc.encode(s));
				send(sse({ role: "assistant", content: "" }));
				if (call) {
					send(sse({ tool_calls: [{ index: 0, id: "call_demo_1", type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }));
					send(sse({}, "tool_calls", USAGE));
				} else {
					for (const w of reply.split(" ")) { send(sse({ content: w + " " })); await new Promise((r) => setTimeout(r, 20)); }
					send(sse({}, "stop", USAGE));
				}
				send("data: [DONE]\n\n");
				c.close();
			},
		});
		return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
	},
});
console.error(`mock-llm listening on http://127.0.0.1:${port}`);
