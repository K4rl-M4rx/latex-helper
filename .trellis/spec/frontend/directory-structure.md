# Directory Structure

> Module organization and file layout for this VS Code extension.

---

## Overview

This project is a **VS Code extension in plain JavaScript (CommonJS)** — no
build step, no TypeScript, no framework. `package.json` points
`main` at `./src/extension.js` and the extension is loadable as-is.

---

## Layout

```
src/
  extension.js          # Entry: activate()/deactivate(), command + listener registration,
                        # refresh orchestration (requestRefresh / refreshFormulas)
  formula/
    parser.js           # .tex text → { preamble, formulas, theorems } (pure, no vscode API)
    compiler.js         # latex → dvisvgm → SVG pipeline (child_process)
    cache.js            # SVG cache under globalStoragePath/cache (sha256-16 keyed)
    panel.js            # Sidebar WebviewView provider + ALL webview HTML (getPanelHtml / getBrowserHtml)
    browser.js          # Editor-tab WebviewPanel wrapper; owns persisted UI state (recent/pinned)
  snippets/
    config.js           # Snippet normalization + 5s config cache (1:1 latex-utilities rules)
    provider.js         # CompletionItemProvider + expandBody/convertBody
    importer.js         # One-time import from latex-utilities settings.json (JSONC tolerant)
    live-watcher.js     # Live auto-expansion watcher + SPECIAL_ACTION (FRACTION/BREAK/SYMPY)
  tree/
    group-mode.js       # Native TreeView for section/subsection group mode
  utils/
    tex.js              # Shared TeX text utilities (environments, labels, refs, sections, mode detection)
test/
  *.test.js             # Hand-rolled node test scripts (no framework), vscode API stubbed
test-tex/               # Sample .tex fixtures for manual testing
```

---

## Conventions

- **One module per file**, kebab-case filenames (`live-watcher.js`).
- **CommonJS**: `require` at top, `module.exports = { ... }` at bottom.
- **`src/utils/` and `src/formula/parser.js` stay vscode-free** where possible so
  unit tests can stub the `vscode` module (see `test/snippets.test.js`).
- New webview HTML goes into `panel.js` next to the existing
  `getPanelHtml` / `getBrowserHtml` generators — do not scatter HTML across files.
- Extension-host classes expose `_onX` callback fields (e.g.
  `panelProvider._onClearCache`) that `extension.js` wires up; keep that wiring
  in `activate()`, not inside the classes.

## Anti-patterns

- Do not add a bundler/transpiler — the extension must stay `require`-able directly.
- Do not import `vscode` in `utils/tex.js` or `formula/parser.js` (breaks test stubs).
