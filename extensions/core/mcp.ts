/**
 * Minimal MCP client (Streamable HTTP, JSON-RPC 2.0) for the Figma *desktop* MCP server
 * (default http://127.0.0.1:3845/mcp). Handles JSON and SSE responses and the Mcp-Session-Id header.
 */
import { requestSignal } from "./api.ts";

export const DEFAULT_MCP_URL = "http://127.0.0.1:3845/mcp";

export interface McpTool {
	name: string;
	description?: string;
	inputSchema?: Record<string, any>;
}
export interface McpContent {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
}
export interface McpResult {
	content: McpContent[];
	isError?: boolean;
}

export class McpClient {
	private session?: string;
	private id = 0;
	private ready?: Promise<void>;

	constructor(private o: { url: () => string | undefined; fetch?: typeof fetch; timeoutMs?: number }) {}

	get url(): string {
		return this.o.url() || DEFAULT_MCP_URL;
	}

	private async rpc(method: string, params?: unknown, notify = false): Promise<any> {
		const body: Record<string, unknown> = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
		if (!notify) body.id = ++this.id;
		const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
		if (this.session) headers["mcp-session-id"] = this.session;
		let res: Response;
		try {
			res = await (this.o.fetch ?? fetch)(this.url, { method: "POST", headers, body: JSON.stringify(body), signal: requestSignal(this.o.timeoutMs ?? 60_000) });
		} catch (e) {
			if ((e as Error).name === "AbortError") throw e;
			throw new Error(`Figma desktop MCP server not reachable at ${this.url} (${(e as Error).message}). Open the Figma desktop app, then Dev Mode → "Enable desktop MCP server".`);
		}
		this.session = res.headers.get("mcp-session-id") ?? this.session;
		if (!res.ok) throw new Error(`Figma desktop MCP ${method} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
		if (notify) return undefined;
		const raw = await res.text();
		const msg = (res.headers.get("content-type") ?? "").includes("text/event-stream") ? parseSse(raw, body.id as number) : raw ? JSON.parse(raw) : {};
		if (msg.error) throw new Error(`Figma desktop MCP ${method}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
		return msg.result;
	}

	/** Initialize once; reset on failure so the next call retries (e.g. after the app starts). */
	connect(): Promise<void> {
		this.ready ??= (async () => {
			await this.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "pi-figma-kit", version: "1" } });
			await this.rpc("notifications/initialized", undefined, true);
		})().catch((e) => {
			this.ready = undefined;
			this.session = undefined;
			throw e;
		});
		return this.ready;
	}

	reset(): void {
		this.ready = undefined;
		this.session = undefined;
	}

	async listTools(): Promise<McpTool[]> {
		await this.connect();
		const out: McpTool[] = [];
		let cursor: string | undefined;
		do {
			const r = await this.rpc("tools/list", cursor ? { cursor } : undefined);
			out.push(...(r?.tools ?? []));
			cursor = r?.nextCursor;
		} while (cursor);
		return out;
	}

	async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpResult> {
		await this.connect();
		try {
			return (await this.rpc("tools/call", { name, arguments: args })) as McpResult;
		} catch (e) {
			if (/HTTP 40[04]/.test((e as Error).message)) this.reset(); // session expired
			throw e;
		}
	}
}

/** Find the JSON-RPC response for `id` in an SSE body. */
export function parseSse(raw: string, id: number): any {
	let last: any = {};
	for (const ev of raw.split(/\r?\n\r?\n/)) {
		const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
		if (!data) continue;
		try {
			const m = JSON.parse(data);
			if (m.id === id) return m;
			last = m;
		} catch {}
	}
	return last;
}
