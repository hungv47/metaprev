# demo.tape — terminal recording for the README.
# Render with: vhs demo.tape  (requires charmbracelet/vhs on PATH)
# Output: demo.gif

Output demo.gif

Set FontSize 14
Set Width 1100
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

# Set up a wrapper so the typed command reads `metaprev` (what users will type)
# while we actually run from source and suppress the browser-open during render.
Hide
Type `metaprev() { bun ./bin/metaprev.ts "$@" --no-open; }`
Enter
Type "clear"
Enter
Show

Type "metaprev https://forsvn.com"
Sleep 500ms
Enter
Sleep 5s

Type "metaprev issues https://forsvn.com"
Sleep 600ms
Enter
Sleep 3s
