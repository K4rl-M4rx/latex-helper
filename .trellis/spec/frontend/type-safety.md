# Type Safety

> Type patterns for a plain-JavaScript codebase (no TypeScript, no build).

---

## Overview

The project is JavaScript with **JSDoc for types** and `@types/vscode` as the
only type dependency. `jsconfig.json` enables editor IntelliSense; there is no
`tsc` step. JSDoc IS the type system here — treat it as load-bearing.

---

## Conventions

- **Every exported function** carries a JSDoc block with `@param` / `@returns`
  and concrete shapes:

  ```js
  /**
   * 编译公式列表为 SVG。
   * @param {string} preamble
   * @param {Array<{label: string, body: string}>} formulas
   * @returns {Promise<Array<{label: string, svg: string}>>}
   */
  async function compileFormulas(preamble, formulas) { ... }
  ```

- **Shared data shapes get a `@typedef`** near their producer, referenced via
  `import('./module').Type` — real example: `NormalizedSnippet` in
  `src/snippets/config.js`, consumed as
  `@param {import('./config').NormalizedSnippet snippet}` in
  `live-watcher.js`.
- **Nullable fields are typed explicitly**: `@type {vscode.WebviewPanel | null}`.
- Class fields initialized in the constructor get an inline `@type` JSDoc
  (see `FormulaBrowser`).
- Union string enums are written out: `@property {'maths'|'text'|'any'} mode`.

## Validation

- Runtime validation is defensive and local: config normalization
  (`normalizeSnippets`) coerces/defaults every field and skips malformed
  entries instead of throwing; webview messages are switched on `type` with
  unknown types falling through.
- No schema libraries — keep validation hand-rolled and co-located with the
  normalization code.

## Anti-patterns

- Do not introduce TypeScript or a compile step.
- Do not leave `@param {any}` — write the object shape inline or add a typedef.
