/**
 * Minimal MCP client (Streamable HTTP, JSON-RPC 2.0) for the Figma *desktop* MCP server
 * (default http://127.0.0.1:3845/mcp). Handles JSON and SSE responses and the Mcp-Session-Id header.
 */
import { CircuitBreaker } from "arrow-resilience-kit";
import { callSignal, requestSignal } from "./api.ts";

export const DEFAULT_MCP_URL = "http://127.0.0.1:3845/mcp";

const HOW_TO_ENABLE = 'Open the Figma desktop app, then Dev Mode → "Enable desktop MCP server".';

/** The desktop server could not be reached at all (refused, DNS, timed out) -- as opposed to an error it returned. */
export class McpUnreachableError extends Error {
	// Explicit constructor: Bun's coverage mis-attributes an Error subclass's implicit one.
	constructor(message: string) {
		super(message);
		this.name = "McpUnreachableError";
	}
}

export interface McpClientOptions {
	url: () => string | undefined;
	fetch?: typeof fetch;
	timeoutMs?: number;
	/** Consecutive unreachable/timed-out calls before failing fast (default 2). */
	breakerThreshold?: number;
	/** How long to fail fast before trying the server again, in ms (default 15s). */
	breakerResetMs?: number;
}

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

/**
 * Talks to the desktop server. Transport calls go through a circuit breaker
 * (arrow-resilience-kit): when the server hangs or is gone, calls fail fast for `breakerResetMs`
 * instead of each waiting out the timeout. Only McpUnreachableError counts; errors the server
 * returns and aborts pass through untouched.
 */
export class McpClient {
	private session?: string;
	private id = 0;
	private ready?: Promise<void>;
	private breaker?: Promise<CircuitBreaker>;

	constructor(private o: McpClientOptions) {}

	get url(): string {
		return this.o.url() || DEFAULT_MCP_URL;
	}

	private async rpc(method: string, params?: unknown, notify = false): Promise<any> {
		this.breaker ??= CircuitBreaker.create(this.o.breakerThreshold ?? 2, this.o.breakerResetMs ?? 15_000, 1, 1);
		const resetSec = Math.round((this.o.breakerResetMs ?? 15_000) / 1000);
		const call = callSignal.getStore(); // read before entering the kit (see requestSignal)
		const out = await (await this.breaker).executeOrFallback<{ ok: any } | { err: unknown }>(
			() => Promise.reject(new McpUnreachableError(`Figma desktop MCP server at ${this.url} was unreachable moments ago; not trying again for up to ${resetSec}s. ${HOW_TO_ENABLE}`)),
			() =>
				this.send(method, params, notify, call).then(
					(ok) => ({ ok }),
					(err) => (err instanceof McpUnreachableError ? Promise.reject(err) : { err }),
				),
		);
		if ("err" in out) throw out.err;
		return out.ok;
	}

	private async send(method: string, params: unknown, notify: boolean, call: AbortSignal | undefined): Promise<any> {
		const body: Record<string, unknown> = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
		if (!notify) body.id = ++this.id;
		const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
		if (this.session) headers["mcp-session-id"] = this.session;
		call?.throwIfAborted(); // the kit may run this a tick later, after an Esc
		let res: Response;
		try {
			res = await (this.o.fetch ?? fetch)(this.url, { method: "POST", headers, body: JSON.stringify(body), signal: requestSignal(this.o.timeoutMs ?? 60_000, call) });
		} catch (e) {
			if ((e as Error).name === "AbortError") throw e;
			throw new McpUnreachableError(`Figma desktop MCP server not reachable at ${this.url} (${(e as Error).message}). ${HOW_TO_ENABLE}`);
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
