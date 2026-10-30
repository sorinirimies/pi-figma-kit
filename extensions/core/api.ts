/** Thin Figma REST client: auth, LRU caching + de-duplication of GETs, rate-limit handling, cancellation, friendly errors. */
import { AsyncLocalStorage } from "node:async_hooks";
import { Retry } from "arrow-resilience-kit";

/**
 * Abort signal of the tool call currently running. The extension sets it around each tool's execute, so
 * every request made during the call is cancelled with it (Esc in pi) without threading it through each call site.
 */
export const callSignal = new AsyncLocalStorage<AbortSignal | undefined>();

/**
 * The current call's signal combined with a timeout. Inside library callbacks (arrow-resilience-kit)
 * pass `call` explicitly, read before entering the library: the async context is only carried into
 * callbacks where the runtime supports `AsyncLocalStorage.snapshot()`, and a wrong context here
 * would let one tool call's Esc cancel another call's request.
 */
export function requestSignal(timeoutMs: number, call: AbortSignal | undefined = callSignal.getStore()): AbortSignal {
	const t = AbortSignal.timeout(timeoutMs);
	return call ? AbortSignal.any([call, t]) : t;
}

/** Resolve with `p`, or reject as soon as the current call is aborted (the shared work keeps running for others). */
function untilAborted<T>(p: Promise<T>): Promise<T> {
	const s = callSignal.getStore();
	if (!s) return p;
	if (s.aborted) return Promise.reject(s.reason);
	return new Promise<T>((res, rej) => {
		const onAbort = () => rej(s.reason);
		s.addEventListener("abort", onAbort, { once: true });
		p.then(res, rej).finally(() => s.removeEventListener("abort", onAbort));
	});
}

export class FigmaError extends Error {
	constructor(
		message: string,
		readonly status: number,
		/** For a 429: how long Figma asked us to wait (Retry-After), in ms. */
		readonly retryAfterMs?: number,
	) {
		super(message);
	}
}

/** Statuses worth retrying for idempotent requests: rate limit and transient gateway/server trouble. */
const TRANSIENT = new Set([429, 502, 503, 504]);

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
	getToken: () => string | undefined;
	baseUrl?: () => string | undefined;
	fetch?: FetchFn;
	/** Cache lifetime for GETs in ms (default 60s; 0 disables). */
	cacheMs?: number;
	/** Longest Retry-After we are willing to wait on a 429, in seconds (default 10). */
	maxRetryWaitSec?: number;
	/** Retries after the first attempt (default 2). */
	retries?: number;
	/** First backoff for transient GET failures in ms (default 500; doubled per retry, capped at 5s). */
	retryBaseMs?: number;
	/** Cache size cap in bytes of response JSON (default 64 MB). Least recently used entries are evicted first. */
	cacheBytes?: number;
	/** Per-request timeout in ms (default 60s for API calls, 120s for downloads). */
	timeoutMs?: number;
	downloadTimeoutMs?: number;
}

type Query = Record<string, string | number | boolean | undefined>;

export class FigmaClient {
	/** Insertion order = recency (re-inserted on hit), so the first key is the least recently used. */
	private cache = new Map<string, { t: number; v: unknown; size: number }>();
	private cacheSize = 0;
	private inflight = new Map<string, Promise<unknown>>();
	constructor(private o: ClientOptions) {}

	clearCache() {
		this.cache.clear();
		this.cacheSize = 0;
	}

	/** Bytes currently held by the GET cache (approximate: response text length). */
	get cachedBytes(): number {
		return this.cacheSize;
	}

	private cacheGet(k: string, ttl: number): unknown {
		const hit = this.cache.get(k);
		if (!hit) return undefined;
		this.cache.delete(k);
		if (Date.now() - hit.t >= ttl) {
			this.cacheSize -= hit.size;
			return undefined;
		}
		this.cache.set(k, hit);
		return hit.v;
	}

	private cachePut(k: string, v: unknown, size: number) {
		const cap = this.o.cacheBytes ?? 64 * 1024 * 1024;
		if (size > cap) return;
		const old = this.cache.get(k);
		if (old) this.cacheSize -= old.size;
		this.cache.delete(k);
		this.cache.set(k, { t: Date.now(), v, size });
		this.cacheSize += size;
		for (const [key, e] of this.cache) {
			if (this.cacheSize <= cap) break;
			this.cache.delete(key);
			this.cacheSize -= e.size;
		}
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
		if (method !== "GET") return untilAborted(this.send<T>(method, url, body).then((r) => r.v));
		const ttl = this.o.cacheMs ?? 60_000;
		const ck = `${this.o.getToken()}|${url}`;
		if (ttl > 0) {
			const hit = this.cacheGet(ck, ttl);
			if (hit !== undefined) return hit as T;
		}
		// Identical concurrent GETs share one request; each caller can still abort its own wait.
		let p = this.inflight.get(ck) as Promise<T> | undefined;
		if (!p) {
			p = this.send<T>("GET", url, undefined)
				.then(({ v, size }) => {
					if (ttl > 0) this.cachePut(ck, v, size);
					return v;
				})
				.finally(() => this.inflight.delete(ck));
			this.inflight.set(ck, p);
		}
		return untilAborted(p);
	}

	/**
	 * One request, retried (arrow-resilience-kit `Retry.withBackoff`):
	 * - 429: after exactly the `Retry-After` Figma sends (up to `maxRetryWaitSec`), any method.
	 * - 502/503/504 and network errors: GETs only (idempotent), with capped exponential backoff.
	 * GETs may be shared between callers, so they only get the timeout, not a caller's abort
	 * signal; POSTs/DELETEs use the call's signal, which also cancels a pending retry wait.
	 */
	private send<T>(method: string, url: string, body: unknown): Promise<{ v: T; size: number }> {
		const doFetch = this.o.fetch ?? fetch;
		const timeout = this.o.timeoutMs ?? 60_000;
		const maxWait = (this.o.maxRetryWaitSec ?? 10) * 1000;
		const idempotent = method === "GET";
		const call = idempotent ? undefined : callSignal.getStore(); // read before entering the kit (see requestSignal)
		const headers = { ...this.headers(), ...(body ? { "Content-Type": "application/json" } : {}) };
		const attempt = async () => {
			call?.throwIfAborted(); // the kit may run this a tick (or a retry wait) later, after an Esc
			const signal = requestSignal(timeout, call);
			const res = await doFetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal }).catch((e: Error) => {
				throw e.name === "TimeoutError" ? new FigmaError(`Figma API timed out after ${timeout / 1000}s: ${url}`, 408) : e;
			});
			if (res.status === 429) {
				const wait = Number(res.headers.get("retry-after") ?? "1");
				const ms = Number.isFinite(wait) ? Math.max(wait, 0) * 1000 : 1000;
				// Too long to wait inside a tool call: no retryAfterMs, so it isn't retried.
				throw ms <= maxWait ? new FigmaError(`Figma rate limit hit (429).`, 429, ms) : new FigmaError(`Figma rate limit hit; retry after ${wait}s.`, 429);
			}
			if (!res.ok) throw new FigmaError(await explain(res), res.status);
			const raw = await res.text();
			return { v: (raw ? JSON.parse(raw) : {}) as T, size: raw.length };
		};
		return Retry.withBackoff(attempt, {
			retries: this.o.retries ?? 2,
			baseMillis: this.o.retryBaseMs ?? 500,
			maxDelayMillis: 5_000,
			shouldRetry: (e: unknown) =>
				e instanceof FigmaError
					? e.status === 429
						? e.retryAfterMs !== undefined
						: idempotent && TRANSIENT.has(e.status)
					: idempotent && e instanceof TypeError, // fetch's network failure ("fetch failed")
			delayMillis: (e: unknown) => (e instanceof FigmaError ? e.retryAfterMs : undefined),
			signal: call,
		});
	}

	get<T = any>(path: string, query?: Query) {
		return this.request<T>("GET", path, query);
	}
	post<T = any>(path: string, body: unknown, query?: Query) {
		return this.request<T>("POST", path, query, body);
	}

	/** Download an arbitrary URL (rendered image / image fill) as bytes. */
	async download(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
		const timeout = this.o.downloadTimeoutMs ?? 120_000;
		const res = await (this.o.fetch ?? fetch)(url, { signal: requestSignal(timeout) }).catch((e: Error) => {
			throw e.name === "TimeoutError" ? new FigmaError(`Download timed out after ${timeout / 1000}s: ${url}`, 408) : e;
		});
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
