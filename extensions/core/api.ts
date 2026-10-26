/** Thin Figma REST client: auth, caching of GETs, rate-limit handling, friendly errors. */
export class FigmaError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
	getToken: () => string | undefined;
	baseUrl?: () => string | undefined;
	fetch?: FetchFn;
	/** Cache lifetime for GETs in ms (default 60s; 0 disables). */
	cacheMs?: number;
	/** Longest Retry-After we are willing to wait on a 429, in seconds. */
	maxRetryWaitSec?: number;
	sleep?: (ms: number) => Promise<void>;
}

type Query = Record<string, string | number | boolean | undefined>;

export class FigmaClient {
	private cache = new Map<string, { t: number; v: unknown }>();
	constructor(private o: ClientOptions) {}

	clearCache() {
		this.cache.clear();
	}

	private url(path: string, query?: Query): string {
		const base = (this.o.baseUrl?.() || "https://api.figma.com").replace(/\/$/, "");
		const u = new URL(base + path);
		for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
		return u.toString();
	}

	private headers(): Record<string, string> {
		const token = this.o.getToken();
		if (!token) throw new FigmaError("No Figma token. Set FIGMA_ACCESS_TOKEN or run `/figma login <personal-access-token>`.", 401);
		// Personal access tokens use X-Figma-Token; OAuth tokens use Bearer.
		return !token.startsWith("figu_") ? { "X-Figma-Token": token } : { Authorization: `Bearer ${token}` };
	}

	async request<T>(method: "GET" | "POST" | "DELETE", path: string, query?: Query, body?: unknown): Promise<T> {
		const url = this.url(path, query);
		const ttl = this.o.cacheMs ?? 60_000;
		const ck = `${this.o.getToken()}|${url}`;
		if (method === "GET" && ttl > 0) {
			const hit = this.cache.get(ck);
			if (hit && Date.now() - hit.t < ttl) return hit.v as T;
		}
		const doFetch = this.o.fetch ?? fetch;
		const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
		for (let attempt = 0; ; attempt++) {
			const res = await doFetch(url, {
				method,
				headers: { ...this.headers(), ...(body ? { "Content-Type": "application/json" } : {}) },
				body: body ? JSON.stringify(body) : undefined,
			});
			if (res.status === 429 && attempt < 2) {
				const wait = Number(res.headers.get("retry-after") ?? "1");
				if (wait <= (this.o.maxRetryWaitSec ?? 10)) {
					await sleep(Math.max(wait, 0.1) * 1000);
					continue;
				}
				throw new FigmaError(`Figma rate limit hit; retry after ${wait}s.`, 429);
			}
			if (!res.ok) throw new FigmaError(await explain(res), res.status);
			const v = (await res.json()) as T;
			if (method === "GET" && ttl > 0) this.cache.set(ck, { t: Date.now(), v });
			return v;
		}
	}

	get<T = any>(path: string, query?: Query) {
		return this.request<T>("GET", path, query);
	}
	post<T = any>(path: string, body: unknown, query?: Query) {
		return this.request<T>("POST", path, query, body);
	}

	/** Download an arbitrary URL (rendered image / image fill) as bytes. */
	async download(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
		const res = await (this.o.fetch ?? fetch)(url);
		if (!res.ok) throw new FigmaError(`Download failed (${res.status}): ${url}`, res.status);
		return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "application/octet-stream" };
	}
}

async function explain(res: Response): Promise<string> {
	let detail = "";
	try {
		const j: any = await res.json();
		detail = j.message || j.err || j.error || "";
	} catch {}
	const hint =
		res.status === 403 ? " (token invalid/expired, missing scope, or no access to this file)" :
		res.status === 404 ? " (not found: check the file key / node id)" :
		res.status === 401 ? " (unauthorized: check your token)" : "";
	return `Figma API ${res.status}${hint}${detail ? `: ${detail}` : ""}`;
}
