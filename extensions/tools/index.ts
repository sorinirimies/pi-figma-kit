import { assetTools } from "./assets.ts";
import { browseTools } from "./browse.ts";
import { desktopTools } from "./desktop.ts";
import { extraTools } from "./extra.ts";
import { readTools } from "./read.ts";
import { systemTools } from "./system.ts";
import type { Ctx } from "./util.ts";

export function allTools(ctx: Ctx) {
	return [...readTools(ctx), ...assetTools(ctx), ...systemTools(ctx), ...browseTools(ctx), ...extraTools(ctx), ...desktopTools(ctx)];
}
