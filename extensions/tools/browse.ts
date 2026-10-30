/** Account/project browsing + collaboration (comments, versions). */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { parseFigmaRef } from "../core/url.ts";
import { simplify } from "../design/simplify.ts";
import { diffTrees } from "../design/treediff.ts";
import { type Ctx, FILE, fetchNodes, nodeUrl, target, text } from "./util.ts";

export function browseTools({ client }: Ctx) {
	const whoami = defineTool({
		name: "figma_whoami",
		label: "Figma: who am I",
		description: "The authenticated Figma user (token check).",
		parameters: Type.Object({}),
		async execute() {
			const me = await client.get("/v1/me");
			return text(`${me.handle} <${me.email}> id=${me.id}`);
		},
	});

	const parse = defineTool({
		name: "figma_parse_url",
		label: "Figma: parse URL",
		description: "File key and node id of a Figma URL (offline).",
		parameters: Type.Object({ url: Type.String() }),
		async execute(_id, p) {
			const r = parseFigmaRef(p.url);
			return text(JSON.stringify(r));
		},
	});

	const projects = defineTool({
		name: "figma_list_projects",
		label: "Figma: team projects",
		description: "Projects of a team (id from figma.com/files/team/<ID>).",
		parameters: Type.Object({ team_id: Type.String() }),
		async execute(_id, p) {
			const r = await client.get(`/v1/teams/${p.team_id}/projects`);
			return text(`${r.name ?? "Team " + p.team_id}\n` + (r.projects ?? []).map((x: any) => `- "${x.name}" project_id=${x.id}`).join("\n"));
		},
	});

	const files = defineTool({
		name: "figma_list_files",
		label: "Figma: project files",
		description: "Files of a project (key, name, modified, URL).",
		parameters: Type.Object({ project_id: Type.String(), branch_data: Type.Optional(Type.Boolean()) }),
		async execute(_id, p) {
			const r = await client.get(`/v1/projects/${p.project_id}/files`, { branch_data: p.branch_data });
			return text(`${r.name ?? "Project"}\n` + (r.files ?? []).map((f: any) => `- "${f.name}" key=${f.key} modified=${f.last_modified} https://www.figma.com/design/${f.key}`).join("\n"));
		},
	});

	const comments = defineTool({
		name: "figma_get_comments",
		label: "Figma: comments",
		description: "Comments on a file (author, text, replies, node).",
		parameters: Type.Object({ file: FILE, include_resolved: Type.Optional(Type.Boolean()) }),
		async execute(_id, p) {
			const { ref } = target(p.file);
			const r = await client.get(`/v1/files/${ref.key}/comments`);
			const all: any[] = r.comments ?? [];
			const byParent = new Map<string, any[]>();
			for (const c of all) if (c.parent_id) byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c]);
			const lines = all
				.filter((c) => !c.parent_id && (p.include_resolved || !c.resolved_at))
				.map((c) => {
					const replies = (byParent.get(c.id) ?? []).map((r) => `\n    ↳ ${r.user?.handle}: ${r.message}`).join("");
					const node = c.client_meta?.node_id;
					return `[${c.id}] ${c.user?.handle}${c.resolved_at ? " (resolved)" : ""}${node ? ` on #${node} ${nodeUrl(ref.key, node)}` : ""}: ${c.message}${replies}`;
				});
			return text(lines.join("\n") || "No comments.");
		},
	});

	const postComment = defineTool({
		name: "figma_post_comment",
		label: "Figma: post comment",
		description: "WRITE: post a comment, on a node or as a reply. Visible to collaborators.",
		parameters: Type.Object({
			file: FILE,
			message: Type.String(),
			node_id: Type.Optional(Type.String()),
			reply_to: Type.Optional(Type.String({ description: "comment id" })),
		}),
		async execute(_id, p) {
			const { ref, ids } = target(p.file, p.node_id ? [p.node_id] : undefined);
			const body: Record<string, unknown> = { message: p.message };
			if (p.reply_to) body.comment_id = p.reply_to;
			else if (ids[0]) body.client_meta = { node_id: ids[0], node_offset: { x: 0, y: 0 } };
			const r = await client.post(`/v1/files/${ref.key}/comments`, body);
			return text(`Posted comment ${r.id}`);
		},
	});

	const versions = defineTool({
		name: "figma_get_versions",
		label: "Figma: version history",
		description: "Version history of a file.",
		parameters: Type.Object({ file: FILE, limit: Type.Optional(Type.Number({ default: 20 })) }),
		async execute(_id, p) {
			const { ref } = target(p.file);
			const r = await client.get(`/v1/files/${ref.key}/versions`, { page_size: p.limit ?? 20 });
			return text((r.versions ?? []).map((v: any) => `${v.id} ${v.created_at} ${v.user?.handle ?? ""} ${v.label ?? ""}${v.description ? ` — ${v.description}` : ""}`).join("\n") || "No versions.");
		},
	});

	const diff = defineTool({
		name: "figma_diff",
		label: "Figma: what changed",
		description: "What changed in a node between versions (default: last saved version → now): added/removed/moved nodes, text, component and CSS changes.",
		parameters: Type.Object({
			file: FILE,
			node_id: Type.Optional(Type.String({ description: "default: URL node-id" })),
			from: Type.Optional(Type.String({ description: "version id or date (YYYY-MM-DD)" })),
			to: Type.Optional(Type.String({ description: "version id; default: current" })),
		}),
		async execute(_id, p) {
			const { ref, ids } = target(p.file, p.node_id ? [p.node_id] : undefined);
			if (!ids.length) throw new Error("No node id. Pass node_id or a URL with ?node-id=.");
			const from = await resolveVersion(ref.key, p.from);
			const [a, b] = await Promise.all([fetchNodes(client, ref.key, [ids[0]!], undefined, from.id), fetchNodes(client, ref.key, [ids[0]!], undefined, p.to)]);
			const opts = (r: typeof a) => ({ depth: 30, maxNodes: 5000, components: r.components, styles: r.styles });
			const where = `#${ids[0]} from version ${from.label} to ${p.to ? `version ${p.to}` : "now"}`;
			if (!a.docs[0] && !b.docs[0]) throw new Error(`Node ${ids[0]} not found in either version.`);
			if (!a.docs[0]) return text(`${where}: the node did not exist yet (added since).`);
			if (!b.docs[0]) return text(`${where}: the node was deleted.`);
			const d = diffTrees(simplify(a.docs[0], opts(a)), simplify(b.docs[0], opts(b)));
			const head = `${where}: ${d.added} added, ${d.removed} removed, ${d.changed} changed`;
			return text(d.lines.length ? `${head}\n${d.lines.join("\n")}` : `${head}. No differences.`, { added: d.added, removed: d.removed, changed: d.changed });
		},
	});

	/** A version id as is; a date -> the last version saved on or before that day (UTC); nothing -> the latest version. */
	async function resolveVersion(key: string, from: string | undefined): Promise<{ id: string; label: string }> {
		const date = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${from}T23:59:59.999Z`) : undefined;
		if (from && date === undefined) return { id: from, label: from };
		const list: any[] = (await client.get(`/v1/files/${key}/versions`, { page_size: 100 })).versions ?? [];
		const v = date === undefined ? list[0] : list.find((x) => Date.parse(x.created_at) <= date);
		if (!v) throw new Error(date === undefined ? "This file has no saved versions yet." : `No version saved on or before ${from} among the last ${list.length}.`);
		return { id: String(v.id), label: `${v.id} (${v.created_at}${v.label ? `, "${v.label}"` : ""})` };
	}

	return [whoami, parse, projects, files, comments, postComment, versions, diff];
}
