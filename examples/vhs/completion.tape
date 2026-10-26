# VHS tape: completion
# Tab-completion for /figma, with a description for every option.
#
# Runs a real pi with only the pi-figma-kit extension loaded, against a fake Figma (mock-figma.ts)
# and a scripted model (mock-llm.ts). HOME and the pi agent dir are redirected into /tmp, so no real
# token, file or path is ever recorded.

Output examples/vhs/generated/completion.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 720
Set Padding 24
Set PlaybackSpeed 1.0
Set Theme "Catppuccin Mocha"

Hide
Type 'bash examples/vhs/fixture.sh >/dev/null && echo DONE-$((6*7))'
Enter
Wait+Screen@60s /DONE-42/
Type 'eval "$(examples/vhs/fixture.sh env)" && clear'
Enter
Type "(bun examples/vhs/mock-figma.ts >/dev/null 2>&1 &) ; (bun examples/vhs/mock-llm.ts >/dev/null 2>&1 &) ; sleep 1 ; clear"
Enter
Type "bash examples/vhs/pi-demo.sh"
Enter
Wait+Screen@30s /demo-model/
Show
Sleep 1.5s
Type "/figma "
Sleep 2.5s
Type "i"
Sleep 2s
Ctrl+U
Type "/figma t"
Sleep 2.5s

# (hidden) quit pi, then stop the mocks
Hide
Ctrl+D
Sleep 1s
Type "pkill -f mock-figma ; pkill -f mock-llm"
Enter
Sleep 500ms
