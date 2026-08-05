# Frontend Development Guidelines

> Conventions for this project's UI layer (VS Code extension webviews, plain JS).

---

## Overview

This project is a **VS Code extension in plain JavaScript (CommonJS)** — no
framework, no build step. The "frontend" is two webviews (sidebar panel +
browser tab) plus the extension-host code that feeds them. The guides below
document the actual conventions in `src/`, with real file references.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Component Guidelines](./component-guidelines.md) | Webview HTML generators, CSP, host↔webview messaging | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Event subscription, re-entrancy guards, refresh queue, config cache | Filled |
| [State Management](./state-management.md) | workspaceState / host memory / webview-local tiers | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Lint, hand-rolled tests, parity rule, forbidden patterns | Filled |
| [Type Safety](./type-safety.md) | JSDoc-as-type-system conventions | Filled |

---

## Pre-Development Checklist

Before writing code in `src/`:

1. Read the guide matching your change area (webview work → component +
   state; watchers/async → hook guidelines).
2. If the change touches latex-utilities ported behavior, read the
   **Behavioral Parity Rule** in quality-guidelines first.
3. Plan to run `npm run lint` and `node test/*.test.js` before committing.

## Quality Check

Before considering work done:

- [ ] ESLint passes on `src/` and `test/`
- [ ] Existing node test scripts pass; new pure logic has new `check()` cases
- [ ] JSDoc on every new exported function (concrete shapes, no `any`)
- [ ] Persisted state mutated only via owning class methods
- [ ] Webview text escaped; CSP nonce preserved

---

**Language**: Documentation in English; code comments and docstrings in
Chinese (matching the existing codebase); user-facing webview strings in
English.
