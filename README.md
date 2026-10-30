# pi-figma-kit

[![npm](https://img.shields.io/npm/v/pi-figma-kit.svg)](https://www.npmjs.com/package/pi-figma-kit)
[![npm downloads](https://img.shields.io/npm/dm/pi-figma-kit.svg)](https://www.npmjs.com/package/pi-figma-kit)
[![CI](https://github.com/sorinirimies/pi-figma-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/sorinirimies/pi-figma-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Figma for [pi](https://github.com/earendil-works/pi-coding-agent): **33 `figma_*` tools** and a `/figma` command that let the agent explore your Figma files, read designs as compact CSS-annotated trees, look at renders, export assets and design tokens, and generate **HTML / React / Tailwind / Jetpack Compose** scaffolds. You can also browse your teams, projects and files from inside pi.

It talks to the **Figma REST API** directly: no desktop app, no separate MCP server process, nothing to keep running. Works with any file you can open, including ones you only have view access to. If the Figma desktop app is running, an optional **bridge** adds live selection, Dev Mode and Code Connect.

<img src="examples/vhs/generated/overview.gif" alt="pi-figma-kit: /figma whoami, then the agent explores the file, generates Compose code and exports design tokens" width="900">

## Features

- **30 REST tools + 3 desktop tools:** explore files, read designs, render and export, tokens, flows, comments, dev resources.
- **Design → code:** a compact CSS-annotated tree and generators for **HTML, React, Tailwind and Jetpack Compose**.
- **Design tokens:** variables (multi-mode, aliases) or styles as **CSS custom properties, JSON or a Tailwind theme**.
- **Sees the design:** renders frames and shows them to the model inline; exports SVG, PNG, JPG and PDF into your project.
- **`/figma` browser:** team → project → file → frame, then straight to the agent.
- **Desktop bridge (optional):** the frame you have selected in Figma, Dev Mode snippets and Code Connect.
- **Safe by default:** read-only unless you ask; token in a `600` file; **zero runtime dependencies**; no telemetry.
- **Tested:** 95%+ coverage gate, seeded fuzzing, dependency audit.

- [Install](#install) · [Authentication](#authentication) · [How it works](#how-it-works) · [Tools](#tools) · [`/figma` command](#figma-command) · [Workflows](#workflows) · [Design translation](#design-translation) · [Limits](#limits) · [Security](#security-notes) · [Development](#development) · [Releases](#releases)

## Install

From npm:

```bash
pi install npm:pi-figma-kit
```

Or from git:

```bash
pi install git:github.com/sorinirimies/pi-figma-kit
```

Try it without installing: `pi -e ./extensions/figma.ts` from a checkout.

## Authentication

Create a **personal access token**: Figma → *Settings* → *Security* → *Personal access tokens*. Scopes by feature:

| Scope | Needed for |
|---|---|
| `file_content:read` | design context, code, screenshots, assets, search, flows, text |
| `file_metadata:read` | file meta |
| `file_comments:read` / `file_comments:write` | `figma_get_comments`, `figma_post_comment`, `figma_delete_comment` |
| `file_versions:read` | `figma_get_versions` |
| `library_content:read` | components, styles (file, team and by key) |
| `file_variables:read` (+ `:write`) | variables, token export, `figma_update_variables` (**Enterprise plans**) |
| `file_dev_resources:read` / `:write` | Dev Mode resources |
| `projects:read` | `figma_list_projects`, `figma_list_files`, `/figma` browser |
| `current_user:read` | `figma_whoami`, `/figma login` check |

Then either:

```bash
export FIGMA_ACCESS_TOKEN=figd_...      # also FIGMA_TOKEN / FIGMA_API_KEY; wins over the saved token
```

or inside pi: `/figma login figd_...`, saved to `~/.pi/agent/figma.json` (file mode `600`). OAuth tokens (`figu_…`) are sent as `Authorization: Bearer`, personal tokens as `X-Figma-Token`.

## How it works

```
 you / the agent                       pi-figma-kit (in pi's process)                         Figma
┌──────────────────┐   tool call   ┌─────────────────────────────────────────────┐        ┌────────────┐
│ "implement this  │ ────────────▶ │ tools/   parse URL → file key + node id     │        │            │
│  frame ..."      │               │    │                                        │  REST  │ api.figma  │
│                  │               │    ▼                                        │ ─────▶ │   .com     │
│                  │               │ core/api  auth · 60 s GET cache · 429 retry │ ◀───── │            │
│                  │ ◀──────────── │    │                                        │  JSON  │            │
│  compact text,   │   text/image  │    ▼                                        │        └────────────┘
│  images, files   │               │ design/  Figma JSON → CSS → DNode tree      │
└──────────────────┘               │          → outline / HTML / React / TW /    │
                                   │            Compose / tokens / flows         │
                                   └─────────────────────────────────────────────┘
```

1. **Registration.** On load, the extension registers every tool with pi (`pi.registerTool`) and the `/figma` command. The saved config is read lazily on first use, so startup is instant and does no network I/O.
2. **Addressing.** Every tool takes a Figma **URL or file key**. A URL's `?node-id=12-34` (or branch URL) is parsed into file key + node id `12:34`, so you can paste a link from Figma's *Copy link to selection* and the agent sees exactly that frame.
3. **Fetching.** `core/api.ts` is a thin REST client: token header, per-URL GET cache (60 s, so exploring the same file repeatedly costs one request), automatic retry on short `429` `Retry-After`s, and error messages that tell you what to fix (bad token, missing scope, wrong key).
4. **Simplifying.** The raw Figma node JSON is huge and noisy. `design/simplify.ts` walks it and produces a **DNode tree**: hidden layers dropped, depth and node budget enforced, auto-layout turned into flex, paints into CSS, text into typography (including mixed-style runs), instances annotated with their component names, applied styles by name, and icon-only subtrees collapsed into a single *SVG asset* so you export them instead of rebuilding vectors.
5. **Emitting.** From the DNode tree the tools render a compact **outline** (`figma_get_design_context`), or generate code (`figma_generate_code` → HTML+CSS, React, Tailwind, Compose). Tokens (`figma_export_tokens`) and prototype flows (`figma_get_prototype_flows`) have their own translators.
6. **Seeing and exporting.** `figma_get_screenshot` asks Figma to render nodes, downloads the PNG/JPG, **returns it inline as an image** the model can look at, and saves it. `figma_download_assets` writes SVG/PNG/JPG/PDF files into your project.
7. **Responses are bounded.** Output is truncated at 60 000 characters with a hint to lower `depth` / `max_nodes`, so one huge frame can't blow the context.

The code layout mirrors that pipeline:

```
extensions/
  figma.ts            wiring only: registers the tools and /figma
  core/               url parsing · config (token) · REST client · mcp.ts (desktop MCP client)
  design/             css.ts (Figma → CSS) · simplify.ts (DNode tree + outline) · codegen.ts (HTML/React/Tailwind)
                      compose.ts (Jetpack Compose) · tokens.ts (CSS/JSON/Tailwind) · flows.ts (prototype graph)
  tools/              read.ts · assets.ts · system.ts · browse.ts · extra.ts · desktop.ts · util.ts · index.ts
  command/            /figma
```

## Tools

Every `file` argument accepts a Figma URL (its `node-id` is used automatically) or a file key. `node_ids` accept `1:2` or `1-2`.

### Explore

| Tool | What it does |
|---|---|
| `figma_get_file_structure` | Pages and top-level frames with ids, sizes and URLs. **Start here.** |
| `figma_search_nodes` | Find nodes by name or text, as substring or `/regex/`, filtered by type |
| `figma_get_file_meta` | Name, folder, creator, last editor, link access, no document download |
| `figma_get_versions` | Version history |
| `figma_list_projects` / `figma_list_files` | Team → project → file |
| `figma_get_prototype_flows` | Flow starting points and every interaction (trigger → destination / URL / back) |

### Read designs and generate code

| Tool | What it does |
|---|---|
| `figma_get_design_context` | Compact tree with layout, fills, gradients, borders, radii, shadows, blurs, typography, text runs, component and style names, and icon / image-fill detection. `outline` or `json`. |
| `figma_generate_code` | Scaffold as `html`, `react`, `tailwind` or `compose` (Kotlin, with imports) |
| `figma_get_text` | All text of a node with ids, sizes and layer path: copy deck / i18n strings |
| `figma_get_node_raw` | Raw REST JSON for nodes (constraints, interactions, bound variables…) |

### See and export

| Tool | What it does |
|---|---|
| `figma_get_screenshot` | Render nodes; PNG/JPG shown inline (up to 4) and saved, SVG/PDF saved |
| `figma_download_assets` | Export nodes as `svg` / `png` / `jpg` / `pdf` into the project (`scale` 1–4) |
| `figma_download_image_fills` | Download original bitmaps by `imageRef`; without refs, lists them |

### Design system

| Tool | What it does |
|---|---|
| `figma_export_tokens` | Variables (or styles as fallback) → **CSS custom properties**, **JSON** or **Tailwind** theme. Multi-mode (`[data-mode="Dark"]` overrides), aliases become `var()`. |
| `figma_get_variables` / `figma_get_published_variables` | Variable collections, modes and values (Enterprise) |
| `figma_get_styles` | File styles resolved to CSS values |
| `figma_get_team_styles` | Team library styles |
| `figma_get_components` | Components and component sets of a file or a team library, with search |
| `figma_get_component` / `figma_get_style` | Look up one published component, component set or style by key |
| `figma_update_variables` | **Write.** Raw create/update/delete of variables (Enterprise) |

### Collaboration

| Tool | What it does |
|---|---|
| `figma_get_comments` | Threads with replies, resolved state and anchored node |
| `figma_post_comment` | **Write.** New comment (optionally on a node) or reply |
| `figma_delete_comment` | **Write.** Delete a comment |
| `figma_get_dev_resources` / `figma_create_dev_resource` | Dev Mode links on nodes; attach a PR or source file to a node (**write**) |

### Figma desktop bridge (optional)

| Tool | What it does |
|---|---|
| `figma_desktop_selection` | Design context (+ optional screenshot) of the frame **currently selected** in the Figma app, or of a node id; accepts language/framework hints |
| `figma_desktop_call` | Call any tool of the desktop MCP server (`get_design_context`, `get_metadata`, `get_screenshot`, `get_variable_defs`, `get_code_connect_map`, …) |
| `figma_desktop_tools` | List the desktop server's tools with their schemas; doubles as a connectivity check |

These talk to Figma's own MCP server running in the desktop app (default `http://127.0.0.1:3845/mcp`, MCP Streamable HTTP; JSON and SSE replies are both handled). They give you what REST can't: **live selection, Dev Mode snippets and Code Connect**. Enable it in Figma: *Dev Mode → "Enable desktop MCP server"* (needs a Dev or Full seat). If the app isn't running, only these three tools fail, with a message saying so; everything else keeps working. Override the URL with `FIGMA_MCP_URL` or `"desktopUrl"` in `~/.pi/agent/figma.json`. Tool names and arguments come from your Figma version, so call `figma_desktop_tools` first.

### Utility

`figma_whoami` (token check) and `figma_parse_url` (no network).

> Tools marked **Write** change the Figma file/comments. Their descriptions tell the model to use them only when you ask.

## `/figma` command

```
/figma                       interactive browser: team → project → file → frame, then sent to the agent
/figma login <token>         save a token (checks it with /v1/me)
/figma logout
/figma whoami                checks the REST token and whether the desktop bridge is reachable
/figma team <id|url>         add a team to the browser
/figma teams                 list configured teams
/figma tools                 list all figma_* tools (read / write)
/figma open <url>            the agent inspects and summarizes a link
/figma implement <url> [instructions]   fetch the design and implement it in the current project
```

Figma has **no endpoint that lists your teams**, so add one once with `/figma team 123456789` (the id is in `figma.com/files/team/<ID>/…`, a full URL works too). The browser then lists its projects and files, shows each file's frames, and sends your pick to the agent.

## Workflows

**Implement a screen**

```
/figma implement https://www.figma.com/design/KEY/App?node-id=12-34 as a Compose screen using our theme
```

The agent typically runs `figma_get_design_context` → `figma_get_screenshot` (to see it) → `figma_export_tokens` / `figma_get_styles` (to map colors and type to your theme) → `figma_download_assets` (icons as SVG) → writes the code → renders again to compare.

**Tokens to code**

> Export the Figma variables of `KEY` as CSS and write them to `src/tokens.css`.

**Review a design**

> Summarize the open comments on `KEY` and list which frames they refer to.

**Navigation graph**

> From the prototype flows of `KEY`, generate the navigation routes for the app.

**i18n**

> Extract all text of the Settings frame into `strings.xml`.

## Design translation

What the deterministic translator covers:

| Figma | Output |
|---|---|
| Auto layout (direction, gap, padding, alignment, wrap, fill/hug/fixed) | `display:flex`, `gap`, `padding`, `justify-content`, `align-items`, `flex` / `align-self` (Compose: `Column`/`Row`, `Arrangement`, `Alignment`, `weight`, `fillMax*`) |
| Free-form frames | absolute children with `left`/`top` relative to the parent (Compose: `Box` + `offset`) |
| Fills | solid, linear / radial / angular gradients, image fills (`cover`/`contain`/tile), stacked fills |
| Strokes | `border` (per-side, dashed) or `outline` for outside strokes |
| Corner radius | uniform, per-corner, ellipse → `50%` |
| Effects | drop / inner shadows, layer blur, background blur |
| Opacity, blend mode, rotation, clipping | `opacity`, `mix-blend-mode`, `transform`, `overflow:hidden` |
| Text | family, size, weight, italic, line height, letter spacing, alignment, case, decoration, colour, **mixed-style runs** |
| Instances / styles | component name and applied style names are attached to nodes |
| Icons | vector-only subtrees collapse into one SVG asset |

Generated code is a **scaffold**: structure, spacing, colours and typography are faithful, but you (or the agent) still map it onto your design system's components.

## Previews

Recorded from a real pi with only this plugin loaded, against a **fake Figma** and a scripted model (no token, no network, no real files).

**Browse** (`/figma`): team, project, file, frame, then the agent takes over:

![Browsing teams, projects, files and frames](examples/vhs/generated/browse.gif)

**Design context** (`figma_get_design_context`): a compact tree with layout, fills, gradients, text runs, instance and style names:

![The agent inspects the Welcome frame](examples/vhs/generated/design.gif)

**Code** (`figma_generate_code`, `html` / `react` / `tailwind` / `compose`): here Jetpack Compose with imports and modifiers:

![Jetpack Compose generated from a frame](examples/vhs/generated/compose.gif)

**Design tokens** (`figma_export_tokens`): Light and Dark modes, aliases kept as `var()`:

![Design tokens exported as CSS custom properties](examples/vhs/generated/tokens.gif)

**Explore** (`figma_get_file_structure`, `figma_get_prototype_flows`, `figma_get_comments`):

![File structure, prototype flows and comments](examples/vhs/generated/explore.gif)

**Desktop bridge** (`figma_desktop_selection`): what you have selected in the Figma app right now, with Code Connect:

![The selected frame via the Figma desktop app](examples/vhs/generated/desktop.gif)

**Tab-completion** uses pi's own menu, with a description for every option:

![Autocomplete for /figma](examples/vhs/generated/completion.gif)

## Limits

- The REST tools have no live selection, Code Connect or Dev Mode snippets. Pass links with `node-id`, or use the [desktop bridge](#figma-desktop-bridge-optional) for those.
- Variables and variable writes need a Figma **Enterprise** plan; `figma_export_tokens` falls back to styles otherwise.
- Figma rate-limits per token. Short `429`s are retried; long ones are reported with the wait time.
- Rendered images come from Figma's servers and expire; they are downloaded immediately.
- Gradients/effects that CSS or Compose can't express exactly are approximated (Compose gradients are left as a `TODO` comment with the CSS value).

## Demo recordings

The GIFs above live in [`examples/vhs/generated/`](examples/vhs/generated) and are stored with **Git LFS** (`git lfs install` once). They are recorded with [VHS](https://github.com/charmbracelet/vhs) from a **real pi** that loads only this extension, against `examples/vhs/mock-figma.ts` (a fake of the REST API and of the desktop MCP server, one fictional file) and `examples/vhs/mock-llm.ts` (a scripted model that calls the `figma_*` tools). `HOME` and the pi agent dir are redirected to `/tmp`, so nothing real is recorded.

```sh
just vhs-all          # every tape (examples/vhs/*.tape): needs vhs, ttyd, ffmpeg, pi, bun, python3
just vhs-tape compose # one tape
just vhs-list         # list the tapes
just demo             # try it yourself in a real pi against the fake Figma
```

## Security notes

- **Read-only by default.** Only the tools marked *Write* change anything in Figma, and the model is told to use them only on request.
- **Token handling.** The token is read from the environment or `~/.pi/agent/figma.json` (mode `600`); it is only sent to `api.figma.com` (or `baseUrl` if you set one in that file). It is never logged or echoed in tool output.
- **Files are written only where you point.** `figma_get_screenshot` defaults to a temp directory; `figma_download_*` write into `dir` (default `./assets`, relative to the project).
- **No telemetry.** Zero runtime dependencies.

## Development

```bash
bun install
just check          # typecheck + tests + pack check + nushell tests (what CI runs)
just test           # bun test only (with coverage)
just coverage       # tests + a coverage table
just fuzz           # randomised robustness tests: just fuzz [iterations] [seed]
just audit          # bun audit: known vulnerabilities in dependencies
just push-all       # push main to every configured remote; `just --list` shows pull-all, push-tags-all, release-all, the *-force and sync-gitea-* variants
```

**Coverage:** every `bun test` collects coverage (`bunfig.toml`) and **fails below 95% lines / 95% functions**. All Figma calls are mocked (`tests/fixtures.ts`), so tests need no token or network.

**Fuzzing:** `tests/fuzz.test.ts` throws seeded random Figma nodes, variables, URLs and MCP replies at the translators and clients (they must never throw). A failure prints `FUZZ_SEED=…` to replay it. A short run is part of `bun test`; the **Fuzz** workflow runs 200 000 iterations nightly.

**Audit:** the **Security** workflow runs `bun audit` nightly and on every dependency change.

To add a tool: write it in the matching file under `extensions/tools/` with `defineTool`, add it to that file's returned list, and add a test in `tests/extension.test.ts` (the first test pins the tool list).

CI scripts are [nushell](https://www.nushell.sh) (`scripts/`), the same ones locally and in GitHub / Gitea Actions. `just --list` shows every task.

## Releases

| Workflow | When | What |
|---|---|---|
| **CI** | push / PR | quality gate (typecheck, tests with coverage, pack check, nushell tests) |
| **Fuzz** | nightly, and when extensions change | 200 000 seeded iterations per property |
| **Security** | nightly, and when dependencies change | `bun audit` |
| **Nightly Dependency Update** | every night | `bun update` within ranges, verify, commit `chore(deps)`, then build, tag and publish a patch when something changed |
| **Release** | tag `vX.Y.Z` | validates the tag against `package.json`, runs the gate, `npm publish` (idempotent, with provenance), creates the release |

Manual release: `just release patch` (or `minor` / `major` / `X.Y.Z`); `just release-all patch` pushes to every remote.

**Secrets:** `NPM_TOKEN` (granular access token with publish rights and "bypass 2FA"). Optional: `GH_PAT`, `GITEA_TOKEN`.

Commits follow [Conventional Commits](https://www.conventionalcommits.org); the changelog is generated by git-cliff.

## Related plugins

Small [pi](https://github.com/earendil-works/pi-coding-agent) extensions by the same author:

| Plugin | What it does |
|---|---|
| [**pi-tokenburn**](https://github.com/sorinirimies/pi-tokenburn) | Live token and cost counter in pi's footer, with charts and budgets |
| [**pi-context-diet**](https://github.com/sorinirimies/pi-context-diet) | Drops stale tool results from the context when the prompt cache is cold |
| [**pi-edit-first**](https://github.com/sorinirimies/pi-edit-first) | Steers the agent to targeted `edit` calls instead of whole-file rewrites |
| [**pi-read-guard**](https://github.com/sorinirimies/pi-read-guard) | Blocks full reads of large files |

## License

MIT
