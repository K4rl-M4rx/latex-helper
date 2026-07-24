# Quality Guidelines

> Code quality standards for frontend development in this VS Code extension.

---

## Linting

- Run `npm run lint` before committing. The project uses ESLint with `.eslintrc.json`.
- Common rules:
  - `no-unused-vars` — unused variables/functions should be removed or prefixed with `_` for arguments.
  - `no-console` — avoid `console.log`; `console.error` is allowed for error reporting.
  - `no-useless-escape` — regex/string escapes must be necessary.

## Forbidden Patterns

- **Do not register a command in code without adding it to `package.json`**. VS Code requires every command used by `vscode.commands.registerCommand` to be declared under `contributes.commands` in `package.json`. Otherwise, the command will not appear in the Command Palette and may fail in packaged builds.
- **Do not leave `console.log` debug statements in production code**. Use `console.error` only for actual errors.

## Required Patterns

- **Track the active LaTeX document explicitly** rather than relying on `vscode.window.activeTextEditor`. When the user interacts with a `Webview` panel or `TreeView`, focus is not in the editor, so `activeTextEditor` may be `undefined`.
- **Serialize long-running operations** such as LaTeX compilation. Use a queue (`isRefreshing` + `queuedRefreshDoc`) so rapid clicks do not spawn concurrent `latex`/`dvisvgm` processes.

## Code Review Checklist

- [ ] Does `npm run lint` pass?
- [ ] Are all registered commands listed in `package.json`?
- [ ] No debug `console.log` left in?
- [ ] Does the change handle the case where the active editor is a `Webview`/`TreeView`?
