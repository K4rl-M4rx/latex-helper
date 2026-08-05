# Quality Guidelines

> Code standards, testing, and forbidden patterns.

---

## Lint

- `npm run lint` → ESLint 8 (`.eslintrc.json`), covering `src/` and `test/`.
- **Lint must pass before every commit.** Unused vars that are intentional
  get a trailing `// eslint-disable-line no-unused-vars` with a reason in the
  docstring (see `readAuxLabels` in `extension.js`).

## Testing

Hand-rolled node scripts, no framework (`test/*.test.js`):

- Run directly: `node test/snippets.test.js`, `node test/parser.test.js`.
- The `vscode` module is stubbed via `Module._resolveFilename` override +
  `Module._cache` (see the top of `test/snippets.test.js`) — this is why
  `utils/tex.js` and `formula/parser.js` must stay vscode-importable only
  through the stub's surface (`workspace`, `window`, `languages`,
  `Position`, `Range`).
- Assertions use the local `check(name, actual, expected)` helper;
  script exits non-zero on failure. **Expected values are exact strings** —
  no fuzzy matching.
- When porting behavior from latex-utilities, tests pin the ported semantics
  (including documented deliberate deviations, e.g. `getFraction`).

## Behavioral Parity Rule

Several modules are deliberate 1:1 ports of `tecosaur/LaTeX-Utilities`
(snippet normalization defaults, live-expansion watcher, mode detection).
When touching them:

1. Check the upstream source first; record findings in the task's
   `research/` folder.
2. Any deliberate deviation must be documented in the code comment AND in
   the task artifacts (example: FRACTION keeps the paired closing brace in
   the numerator where upstream drops it).

## Webview / DOM

- Escape user/document text with `escapeHtml()` before `innerHTML`.
- Re-render via a single `render()` entry; don't mutate list DOM piecemeal.

## Error Handling

- Compile pipeline errors reject with actionable messages (tool name, exit
  code, last log lines); `refreshFormulas` catches, logs `console.error`,
  and surfaces `vscode.window.showErrorMessage` — never leave the refresh
  queue stuck (the `.finally` in `requestRefresh` releases it).
- Optional-file reads (aux, cache) fail silently by design with a
  `catch { /* ignore */ }` comment.

## Forbidden Patterns

- No `console.log` in `src/` (debug logging); `console.error` in catch paths
  is fine.
- No `eval` in extension code (the SYMPY action shells out to python3 with an
  escaped script via `execFile` — never build shell command strings).
- No git-ignored generated files inside `src/`; compile temp files go to the
  workspace `temp/` folder or OS tmpdir (see `compiler.js#getTempBaseDir`).
- When building a regex from an environment-name list, **escape `*` in names**
  (`align*` → `align\*`). The pre-2026-08 version of
  `findFormulaEnvironments` didn't, so starred environments were silently
  never matched; `test/parser.test.js` now pins this.
