import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface FigmaConfig {
	token?: string;
	/** Teams shown in /figma browse (Figma has no "list my teams" endpoint). */
	teamIds: string[];
	baseUrl?: string;
}

export function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}
export const configPath = () => join(agentDir(), "figma.json");

export async function loadConfig(): Promise<FigmaConfig> {
	try {
		const j = JSON.parse(await readFile(configPath(), "utf8"));
		return { token: typeof j.token === "string" ? j.token : undefined, teamIds: Array.isArray(j.teamIds) ? j.teamIds.map(String) : [], baseUrl: typeof j.baseUrl === "string" ? j.baseUrl : undefined };
	} catch {
		return { teamIds: [] };
	}
}

export async function saveConfig(c: FigmaConfig): Promise<void> {
	const p = configPath();
	await mkdir(dirname(p), { recursive: true });
	await writeFile(p, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
}

/** Env wins over the saved token. */
export function envToken(): string | undefined {
	return process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_TOKEN || process.env.FIGMA_API_KEY || undefined;
}
