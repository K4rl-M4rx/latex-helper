# Implementation Plan: Hybrid Live Snippet System

## Phase 1: Foundation

### 1.1 Refactor TypeFinder
- File: `src/utils/tex.js`
- Replace `isInMathContext` with `getModeAtPosition(document, position)` returning `'maths' | 'text' | 'any'`.
- Handle `$`, `$$`, `\(`, `\)`, `\[`, `\]`, math environments, and `\text{}`.
- Add minimal tests by inspecting a few synthetic `.tex` strings.

### 1.2 Refactor SnippetConfig
- File: `src/snippets/config.js`
- Add normalization: default mode, triggerWhenComplete, priority.
- Compile `prefix` to `RegExp`; catch invalid regex.
- Filter `SPECIAL_ACTION_*` bodies.
- Add helper `getLiveSnippets()` and `getCompletionSnippets()`.

### 1.3 Fix Import Bug
- File: `src/snippets/importer.js`
- Replace naive comment stripping with a JSONC parser or a safer stripper that does not mangle string contents.
- Ensure `//$` prefixes import correctly.

## Phase 2: Live Watcher

### 2.1 Implement LiveWatcher
- New file: `src/snippets/live-watcher.js`
- Class `LiveSnippetWatcher` with `watcher(event)` method.
- Register in `extension.js` via `onDidChangeTextDocument`.
- Use `isApplyingEdit` guard to prevent recursion.
- Implement replacement logic: `a[0].replace(prefixRegex, body).replace(/\$\$/g, '$')`.
- Support both `noPlaceholders` direct edit and placeholder-aware `insertSnippet`.

### 2.2 Update Extension Wiring
- File: `src/extension.js`
- Instantiate `LiveSnippetWatcher` in `activate`.
- Subscribe to `onDidChangeTextDocument`.
- Keep existing `registerSnippetProvider`.

## Phase 3: Completion Provider

### 3.1 Update Completion Provider
- File: `src/snippets/provider.js`
- Use new `getModeAtPosition`.
- Filter by mode.
- Convert body placeholders correctly.
- Lower sort priority.

## Phase 4: Integration & Verification

### 4.1 Test Scenarios
1. Type `//$` inside `$...$` → auto-expand to `\frac{}{}`.
2. Type `frac` inside `$...$` with `triggerWhenComplete: false` → appears in completion list.
3. Type `bf` outside math → `\textbf{}` works.
4. Import `latex-utilities.liveReformat.snippets` with `//$` prefix succeeds.

### 4.2 Run Checks
- `npm run lint`
- Manual F5 test

## Rollback Plan

- If live watcher causes typing lag or conflicts, disable it by setting `latex-helper.liveSnippets.enabled` to `false` (to be added as a fallback setting).

## Files to Modify

- `src/utils/tex.js`
- `src/snippets/config.js`
- `src/snippets/importer.js`
- `src/snippets/provider.js`
- `src/snippets/live-watcher.js` (new)
- `src/extension.js`
- `package.json` (if adding settings)
