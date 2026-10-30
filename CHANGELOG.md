# Changelog

Generated from [Conventional Commits](https://www.conventionalcommits.org) by
[git-cliff](https://git-cliff.org). Do not edit by hand.

## [0.3.0](https://github.com/sorinirimies/pi-figma-kit/releases/tag/v0.3.0) — 2026-10-30


### ✨ Features

- Compact tool declarations, figma namespace + annotations, /figma tools ([`79e1e4b`](https://github.com/sorinirimies/pi-figma-kit/commit/79e1e4be400e64d754955a093c15cc701256eb8a))
- **client:** Cancel requests with the tool call (Esc), timeouts, LRU byte-capped cache, shared in-flight GETs ([`f9319b4`](https://github.com/sorinirimies/pi-figma-kit/commit/f9319b46c1e047e91d9e74f80afc26d53fc36616))
- **assets:** Default file names match generated code, real image-fill types, batched renders, parallel downloads ([`b191af5`](https://github.com/sorinirimies/pi-figma-kit/commit/b191af537810a869d992db6c51ec4dae24718958))
- Confirm destructive Figma writes (update variables, delete comment) in interactive sessions ([`5df269b`](https://github.com/sorinirimies/pi-figma-kit/commit/5df269b14b72d61dc40855f3817c87d08220230d))
- **design:** Token-bound values (variables, fill/stroke styles) emitted as var(--token, literal) in context and codegen ([`f2b7e25`](https://github.com/sorinirimies/pi-figma-kit/commit/f2b7e25d1083e3fb76fac4d4595eb264c562fdc9))
- **codegen:** Idiomatic Tailwind (scale steps, typed arbitrary values), semantic tags, real radial/conic gradients, constraint-aware positioning ([`d75e437`](https://github.com/sorinirimies/pi-figma-kit/commit/d75e437fe99ed04b0d18cd1bc5a2415985d5e3e4))
- **codegen:** Repeated component instances become one React/Compose component with text props; placement stays at the call site ([`cfed08e`](https://github.com/sorinirimies/pi-figma-kit/commit/cfed08e278d509564d2200bfa4f5ff08469a24fa))
- Figma_compare pixel-diffs an implementation screenshot against the design (dependency-free PNG codec, bounded decode) ([`238314e`](https://github.com/sorinirimies/pi-figma-kit/commit/238314ea850555cd8f8ca54b667d12afd7131e37))
- Figma_diff shows what changed in a node between versions (by id or date) ([`4237779`](https://github.com/sorinirimies/pi-figma-kit/commit/42377790ae84638ebba55e04c7ac44ec4ce2062e))
- **client:** Retries via arrow-resilience-kit - exact Retry-After on 429, capped backoff for transient GET failures (502/503/504, network), abort cancels a POST's retry wait ([`55221d2`](https://github.com/sorinirimies/pi-figma-kit/commit/55221d2dabf3e3c02e07306b342bc31b48c4f0ac))
- **mcp:** Circuit breaker on the desktop bridge (arrow-resilience-kit) - fail fast while the server hangs or is gone, only transport failures count; pass the call signal explicitly into kit callbacks and stop before requests once aborted ([`9b3cc40`](https://github.com/sorinirimies/pi-figma-kit/commit/9b3cc40a63c284395e40d35c74088c72e4115f39))

### 📚 Docs

- Network resilience (exact Retry-After, transient GET retries, desktop circuit breaker) ([`f289708`](https://github.com/sorinirimies/pi-figma-kit/commit/f2897081bdb67ccfb7945e1294457eadb9a66ec5))

### 🧪 Tests

- **client:** Concurrent tool calls keep their own abort signal through the kit ([`8b7bf46`](https://github.com/sorinirimies/pi-figma-kit/commit/8b7bf4610dba78b281aade2cd05ec9d7004e095d))

### 🔧 Build & CI

- **deps:** Arrow-resilience-kit ^0.10.0 from npm (was a local link) ([`76d8166`](https://github.com/sorinirimies/pi-figma-kit/commit/76d81667a55378c0b9d9ff0bca358ebb58106fd8))

### 🧹 Chores

- Nightly dev-tooling lockfile update 2026-10-27 (not released) ([`ccb2e23`](https://github.com/sorinirimies/pi-figma-kit/commit/ccb2e230b7906dd2366b0ab0cef6d9d8ed688e02))
- Nightly dev-tooling lockfile update 2026-10-29 (not released) ([`bcf045d`](https://github.com/sorinirimies/pi-figma-kit/commit/bcf045d021506d9d8a895953ddfb555cd1cd7a0b))
- Nightly dev-tooling lockfile update 2026-10-30 (not released) ([`1f22bb1`](https://github.com/sorinirimies/pi-figma-kit/commit/1f22bb1235440205d4bbb2f0c19b71c58d5f2af4))
## [0.2.1](https://github.com/sorinirimies/pi-figma-kit/releases/tag/v0.2.1) — 2026-10-26


### 📚 Docs

- README with demo recordings (VHS), fake Figma + scripted model; feat: /figma completions with descriptions ([`712deb4`](https://github.com/sorinirimies/pi-figma-kit/commit/712deb4bfd30faf013b3c36c02af4bb0fad03216))

### 🧪 Tests

- Seeded fuzz tests (found and fixed 2 crashes), more coverage; ci: nightly fuzz workflow ([`f2699ab`](https://github.com/sorinirimies/pi-figma-kit/commit/f2699ab8b2a96bb5aeb5c21a64944b1d930f4644))
## [0.2.0](https://github.com/sorinirimies/pi-figma-kit/releases/tag/v0.2.0) — 2026-10-26


### ✨ Features

- Figma tools + /figma command for pi ([`cff6d07`](https://github.com/sorinirimies/pi-figma-kit/commit/cff6d0739a6240b36254a86544603a2f0df3949f))
- Compose codegen, token export, prototype flows, text, dev resources, meta, lookups; full README ([`7c35b56`](https://github.com/sorinirimies/pi-figma-kit/commit/7c35b564ca19f25a1104423a8c4a5b52e9957a6d))
- Bridge to the Figma desktop MCP server (selection, Dev Mode, Code Connect) ([`fe28955`](https://github.com/sorinirimies/pi-figma-kit/commit/fe28955abb2ee90af38def94c284f8d00b824713))
- /figma whoami reports desktop bridge status ([`4ea3cd8`](https://github.com/sorinirimies/pi-figma-kit/commit/4ea3cd8b578c3cf9daf06f803aa19219ad3f72b4))

### 📚 Docs

- Changelog ([`7c291ce`](https://github.com/sorinirimies/pi-figma-kit/commit/7c291ced05a75b29c2ae176f69d091a9a5d97029))
- Changelog ([`4b0da0c`](https://github.com/sorinirimies/pi-figma-kit/commit/4b0da0caca155d982804da1b2a039b359b276a3e))

### 🧪 Tests

- Whoami bridge status ([`79ce943`](https://github.com/sorinirimies/pi-figma-kit/commit/79ce9437e6ccdf7819d2403d5d91e20b8e76b568))

### 🔧 Build & CI

- Drop timezone matrix (not relevant here) ([`f14de2c`](https://github.com/sorinirimies/pi-figma-kit/commit/f14de2c4e3234871998262a0f67a60047071b20d))

### 🧹 Chores

- Nushell CI scripts, justfile, workflows, cliff config (from pi-tokenburn); more tests ([`6bbc56b`](https://github.com/sorinirimies/pi-figma-kit/commit/6bbc56b81b1cb766d5537b6c058161842b307543))
- Changelog, coverage threshold 85% ([`85dda2b`](https://github.com/sorinirimies/pi-figma-kit/commit/85dda2b3a0b2be338b16fd236cf5acecaa55a00c))
- Rename to pi-figma-kit (npm name pi-figma-mcp is taken) ([`63780d8`](https://github.com/sorinirimies/pi-figma-kit/commit/63780d856de6a1234718483bc577b65d53013dc3))

