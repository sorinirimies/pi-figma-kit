# pi-figma-mcp

Figma for [pi](https://github.com/earendil-works/pi): a set of `figma_*` tools plus a `/figma` command, built on the Figma REST API. Fetch designs, turn them into code, look at them, export assets, read design tokens, and browse your projects, all from pi. A pi package, no server process.

## Install

```sh
pi install /Users/EBEMXC4/Projects/pi-figma-mcp      # or: pi -e ./extensions/figma.ts
```

Auth: create a personal access token (Figma → Settings → Security) with scopes `file_content:read`, `file_metadata:read`, `file_comments:read/write`, `file_variables:read` (Enterprise), `library_content:read`, `projects:read`, `current_user:read`. Then either

- `export FIGMA_ACCESS_TOKEN=figd_...` (also `FIGMA_TOKEN`), or
- `/figma login figd_...` (saved to `~/.pi/agent/figma.json`, mode 600). OAuth tokens (`figu_`) are sent as Bearer.

## Tools

| Tool | What it does |
| --- | --- |
| `figma_get_file_structure` | Pages and top-level frames with ids/sizes/URLs: start here |
| `figma_get_design_context` | Compact tree with layout (auto-layout → flex), fills, gradients, borders, radii, shadows, blurs, typography (incl. mixed runs), component and style names, icon/image-fill detection |
| `figma_generate_code` | Scaffold as **html+css**, **react**, or **tailwind** |
| `figma_get_screenshot` | Render nodes (png/jpg shown inline, svg/pdf saved) to compare with your implementation |
| `figma_download_assets` / `figma_download_image_fills` | Export icons (svg) and images into the project |
| `figma_get_variables` / `figma_get_styles` / `figma_get_components` | Design tokens, styles resolved to CSS, component library (file or team) |
| `figma_search_nodes` | Find nodes by name/text/type (substring or `/regex/`) |
| `figma_get_node_raw` | Raw REST JSON escape hatch |
| `figma_list_projects` / `figma_list_files` | Team → project → file |
| `figma_get_comments` / `figma_post_comment` / `figma_get_versions` | Collaboration |
| `figma_whoami` / `figma_parse_url` | Token check, URL parsing |

Every `file` argument accepts a Figma URL (its `?node-id=` is used automatically) or a file key. GET responses are cached for 60 s; 429s are retried when `Retry-After` is short.

## `/figma`

```
/figma                       interactive browser: team → project → file → frame → send to the agent
/figma login <token> | logout | whoami
/figma team <id|url>         add a team (Figma can't list your teams; id is in figma.com/files/team/<ID>/…)
/figma open <url>            agent inspects and summarizes a link
/figma implement <url> [instructions]   fetch the design and implement it in the current project
```

## Typical flow

1. `/figma implement https://www.figma.com/design/KEY/Name?node-id=12-34 as a Compose screen`
2. The agent calls `figma_get_design_context`, `figma_get_screenshot`, `figma_download_assets`, and `figma_get_variables`, then writes the code with your project's conventions.

## Limits

The REST API has no "Code Connect", Dev Mode codegen, or selection access (those need the desktop MCP server), and variables need Enterprise. Layout translation is deterministic CSS, so treat generated code as a scaffold.

## Development

```sh
bun install && bun test && bun run typecheck
```
