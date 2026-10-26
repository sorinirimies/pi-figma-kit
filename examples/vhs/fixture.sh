#!/usr/bin/env bash
# Builds the throw-away environment the pi-figma-kit demos (VHS tapes) run in, so no real token,
# file or path ever ends up in a recording. HOME and the pi agent dir live in /tmp.
#
#   examples/vhs/fixture.sh        create /tmp/pi-figma-kit-demo
#   examples/vhs/fixture.sh env    print the environment the demos run with
#
# Run pi against it with:   eval "$(examples/vhs/fixture.sh env)"
set -euo pipefail
mkdir -p /tmp/pi-figma-kit-demo
DEMO="$(cd /tmp/pi-figma-kit-demo && pwd -P)"

if [ "${1:-}" = "env" ]; then
    cat <<ENV
export HOME=$DEMO/home
export PI_CODING_AGENT_DIR=$DEMO/agent
export PI_OFFLINE=1
export TZ=UTC
unset FIGMA_ACCESS_TOKEN FIGMA_TOKEN FIGMA_API_KEY FIGMA_MCP_URL
ENV
    exit 0
fi

rm -rf "$DEMO/home" "$DEMO/agent"
mkdir -p "$DEMO/home/projects/my-app" "$DEMO/agent"
python3 - "$DEMO" <<'PY'
import json, os, sys
root = sys.argv[1]
agent = os.path.join(root, "agent")
# The fake Figma (REST + desktop MCP) is served by examples/vhs/mock-figma.ts.
with open(os.path.join(agent, "figma.json"), "w") as f:
    json.dump({"token": "figd_demo", "teamIds": ["1001"], "baseUrl": "http://127.0.0.1:8990", "desktopUrl": "http://127.0.0.1:8990/mcp"}, f, indent=2)
# A scripted local model (examples/vhs/mock-llm.ts): no login banner, and it calls the figma_* tools.
with open(os.path.join(agent, "models.json"), "w") as f:
    json.dump({"providers": {"demo": {"baseUrl": "http://127.0.0.1:8989/v1", "api": "openai-completions", "apiKey": "demo",
               "models": [{"id": "demo-model", "name": "demo-model", "contextWindow": 200000, "maxTokens": 8192,
                           "cost": {"input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75}}]}}}, f, indent=2)
with open(os.path.join(agent, "settings.json"), "w") as f:
    json.dump({"defaultProvider": "demo", "defaultModel": "demo-model", "theme": "dark", "defaultThinkingLevel": "off",
               "lastChangelogVersion": "9.9.9", "quietStartup": "header"}, f, indent=2)
PY
echo "fixture ready: $DEMO"
