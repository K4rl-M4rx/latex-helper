# PRD: Hybrid Live Snippet System

## Background

The extension currently has a basic `CompletionItemProvider`-based snippet system that does not match the behavior of `latex-utilities.liveReformat.snippets`. Users migrating from `latex-utilities` expect:

1. **Live reformat**: typing a snippet prefix immediately expands it (e.g. `//$` → `\frac{}{}`).
2. **Completion candidates**: snippets that should not auto-expand appear in the IntelliSense list.
3. **Math/text context awareness**: snippets tagged `mode: 'maths'` only work inside math environments, `mode: 'text'` only outside, `mode: 'any'` works everywhere.
4. **Regex prefixes**: `latex-utilities` stores prefixes as strings that are compiled to `RegExp` and may use capture groups.

## Goals

Implement a hybrid snippet engine that combines live expansion and completion-provider behavior, compatible with the existing `latex-helper.snippets` configuration schema and the legacy `latex-utilities.liveReformat.snippets` data.

## Acceptance Criteria

- [ ] Snippets with `triggerWhenComplete: true` expand automatically as the user types the matching prefix, respecting `mode`.
- [ ] Snippets with `triggerWhenComplete: false` (or omitted) appear in the standard completion list when the cursor is in a matching context.
- [ ] Prefixes are treated as regular expressions; capture-group replacement works as in `latex-utilities`.
- [ ] Math/text detection is robust for common LaTeX constructs (`$...$`, `\(...\)`, `\[...\]`, equation/align/gather environments, `\text{}`).
- [ ] The system does not interfere with LaTeX Workshop or other completion providers.
- [ ] Import from `latex-utilities.liveReformat.snippets` succeeds even when prefixes contain `//` (fix the comment-stripping bug).
- [ ] `npm run lint` passes after the change.

## Non-Goals

- `SPECIAL_ACTION_BREAK`, `SPECIAL_ACTION_FRACTION`, `SPECIAL_ACTION_SYMPY` magic bodies from `latex-utilities` are out of scope for this iteration; they may be filtered/ignored.
- UI for editing snippets is out of scope; snippets continue to be edited through `settings.json`.

## Configuration

Uses the existing `latex-helper.snippets` array with fields:

```json
{
  "prefix": "//$",
  "body": "\\frac{$$1}{$$2} ",
  "mode": "maths",
  "description": "fraction (empty)",
  "triggerWhenComplete": true
}
```

## Open Questions

- Should live expansion be globally disableable via a new setting (e.g. `latex-helper.liveSnippets.enabled`)?
- Should the completion list also include live-expansion snippets when the prefix has been partially typed?
