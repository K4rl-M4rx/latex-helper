# Hook Guidelines

> Custom hooks / reusable async-behavior patterns in this project.

---

## Overview

This is a plain-JS VS Code extension — **no React hooks**. The reusable
patterns that play that role are documented here instead: event subscription,
re-entrancy guards, serialized async refresh, and TTL config caching.

---

## Event Subscription

All disposables go through `context.subscriptions.push(...)` in
`activate()` (`src/extension.js`):

```js
context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
        liveWatcher.watcher(event);
    })
);
```

## Re-entrancy Guard (the `isApplyingEdit` pattern)

Any code that edits the document from inside a document-change listener must
guard against re-triggering itself. Real example: `LiveSnippetWatcher`
(`src/snippets/live-watcher.js`):

```js
this.isApplyingEdit = true;
try {
    await editor.edit(...);
} finally {
    this.isApplyingEdit = false;
}
```

Combined with `sameChanges(event)` (skip events identical to the previous
one). Any new watcher that applies edits must implement both.

## Serialized Async Refresh

Compilation is slow; concurrent refreshes must not overwrite newer results.
`requestRefresh()` in `extension.js` serializes with `isRefreshing` +
`queuedRefreshDoc` (keep only the newest queued document, replay once when
the current run finishes). New long-running refresh paths must plug into the
same queue — do not call `refreshFormulas()` directly.

## TTL Config Caching

`getSnippets()` in `src/snippets/config.js` caches normalized config for
`MAX_CONFIG_AGE = 5000` ms (1:1 with latex-utilities) so per-keystroke reads
don't re-parse settings. Follow this pattern for any hot-path config read.

## Common Mistakes

- Spawning parallel compiles per refresh — always go through `requestRefresh`.
- Applying edits without `isApplyingEdit` → infinite watcher loops.
