# Design: Hybrid Live Snippet System

## Architecture

```
settings.json (latex-helper.snippets)
         │
         ▼
┌─────────────────────┐
│   SnippetConfig     │  Loads + normalizes snippets, compiles prefix RegExp,
│   (src/snippets/    │  assigns defaults (mode, priority, triggerWhenComplete).
│    config.js)       │
└─────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
LiveWatcher   CompletionProvider
(src/snippets/ (src/snippets/provider.js)
 live-watcher.js)
    │
    ▼
TypeFinder
(src/utils/tex.js)
```

## Components

### 1. SnippetConfig

- Reads `latex-helper.snippets` on demand (no caching; settings are cheap to read).
- Normalizes each snippet:
  - `mode` defaults to `'any'`
  - `triggerWhenComplete` defaults to `false`
  - `priority` defaults to `0`
  - `prefix` compiled to `RegExp`
  - `noPlaceholders` inferred from body (no `$$N` or `$${N}`)
- Filters out `SPECIAL_ACTION_*` bodies for now.

### 2. TypeFinder

Replace the current `isInMathContext` with a more robust implementation inspired by `latex-utilities`:

- Scan backwards from the cursor line by line.
- Track explicit math delimiters: `$`, `$$`, `\(`, `\)`, `\[`, `\]`.
- Track environment boundaries: `\begin{equation}`, `\end{equation}`, `\begin{align*}` etc.
- Track `\text{...}` mode switches inside math.
- Stop at comment-only lines or at the document start.

Return `'maths' | 'text' | 'any'`.

### 3. LiveWatcher

Registered via `vscode.workspace.onDidChangeTextDocument`.

For each content change:
1. Ignore if change is not a single-character insertion or if cursor is in a problematic location.
2. Determine context with `TypeFinder`.
3. Iterate snippets sorted by priority descending.
4. For each snippet whose `mode` matches context and `triggerWhenComplete === true`:
   - Test prefix RegExp against the line up to the new cursor position.
   - On match, compute replacement range and replacement text.
   - Apply edit via `TextEditor.edit` or `TextEditor.insertSnippet`.
   - Break after the first match (highest priority wins).

Guard against recursive edits with an `isApplyingEdit` flag.

### 4. CompletionProvider

Standard `vscode.CompletionItemProvider` for `'latex'`:

- Read snippets.
- Filter by context (`mode`).
- Convert each snippet to a `CompletionItem` with `SnippetString` body.
- Set `sortText` so snippets appear below language-server suggestions.
- No trigger-character requirement other than the default; the provider will also be invoked automatically while typing.

## Data Flow

### Live expansion

```
User types character
        │
        ▼
onDidChangeTextDocument
        │
        ▼
LiveWatcher.watcher(change)
        │
        ├── TypeFinder.getModeAtPosition(document, position) → 'maths'/'text'/'any'
        │
        ▼
For each triggerWhenComplete=true snippet:
        prefixRegex.test(lineUpToCursor)
        │
        ▼
Compute range + replacement
        │
        ▼
editor.edit(...) or editor.insertSnippet(...)
```

### Completion list

```
User requests completion (Ctrl+Space or automatic)
        │
        ▼
provider.provideCompletionItems(document, position)
        │
        ▼
TypeFinder.getModeAtPosition(...)
        │
        ▼
Filter snippets by mode
        │
        ▼
Return CompletionItem[]
```

## Compatibility with latex-utilities

- Data schema: same field names (`prefix`, `body`, `mode`, `description`, `triggerWhenComplete`).
- Prefix semantics: string compiled to `RegExp`, with capture-group replacement.
- Body placeholders: `$$N` → `$N` for VSCode SnippetString.
- Mode semantics: `maths`/`text`/`any`.

## Error Handling

- Invalid snippet prefix regex: log warning, skip snippet.
- `TypeFinder` errors: fall back to `'any'`.
- Live edit failures: catch and log, do not show intrusive messages.

## Performance

- Snippet list is small (~135 items); linear scan is acceptable.
- TypeFinder scans only lines from cursor to the nearest known mode boundary or document start.
- Live watcher ignores multi-character changes and changes outside the active editor.
