# State Management

> Where state lives, who owns it, and how it syncs.

---

## Overview

Three tiers, with a strict ownership rule: **the extension host is the source
of truth for anything persisted; webviews hold only session-local UI state**.

---

## Tier 1 — Persisted (`context.workspaceState`)

Per-workspace, survives restarts. Keys are namespaced `latex-helper.*`:

| Key | Shape | Owner |
|-----|-------|-------|
| `latex-helper.recentFormulas` | `string[]` (max 5, newest first) | `FormulaBrowser._recentLabels` |
| `latex-helper.pinnedFormulas` | `string[]` (newest pin first) | `FormulaBrowser._pinnedLabels` |
| `latex-helper.showRecentFormulas` | `boolean` (default `true`) | `FormulaBrowser._showRecent` |

Rules:

- Mutations happen **only on the host** via dedicated methods
  (`_recordUsed`, `_togglePin`, `_setShowRecent`), which persist AND push a
  message to the webview in the same method.
- On webview `ready`, the host replays all persisted state
  (see `FormulaBrowser.show()`).

## Tier 2 — Extension-host in-memory

Module-level `let` in `extension.js` (`onlyRef`, `groupMode`,
`currentPreambleHash`, `activeLatexDoc`, refresh-queue flags). Deliberately
NOT persisted — derived per session. Toggle callbacks reset dependent state
(e.g. `_onToggleOnlyRef` resets `currentPreambleHash` to force recompile).

## Tier 3 — Webview-local (session-only)

Top-level `let` in the inline webview script: `collapsedGroups`,
`showPinnedOnly`, `currentView`, `searchMode`, `showUnreferenced`. Never
persisted; reset when the tab is closed (acceptable — `retainContextWhenHidden:
true` preserves them while the tab merely hides).

## Derived / Cached Data

- SVG cache on disk: `globalStoragePath/cache/<bodyHash>.svg` +
  `index.json` (preamble hash, label→hash map). Invalidated by preamble hash
  change or the "Clear Cache" button.
- Snippet config cache: 5 s TTL (see hook-guidelines).

## Common Mistakes

- Persisting webview-side flags — check first whether the flag is pure UI
  session state (Tier 3) or a user preference (Tier 1).
- Writing `workspaceState` from multiple places — route through the owning
  class method so persistence + webview push stay atomic.
