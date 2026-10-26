#!/usr/bin/env bash
# Starts a real pi with ONLY the pi-figma-kit extension loaded, against the fake Figma and the
# scripted model (see fixture.sh, mock-figma.ts, mock-llm.ts): no real files, token or network.
#
#   eval "$(examples/vhs/fixture.sh env)" && bash examples/vhs/pi-demo.sh
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$HOME/projects/my-app"
exec pi --no-extensions -e "$REPO/extensions/figma.ts" --no-builtin-tools \
    --no-skills --no-prompt-templates --no-context-files --no-mcp --offline --no-session
