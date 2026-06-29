# @lembryo/voxsheet

Voxel-style virtual spreadsheet renderer for the web.

Render millions of rows smoothly with DOM-based virtual scrolling. Excel-like
selection, editing, autofill, clipboard, column resize, and host-controlled
sort / filter / search. React component, peer-dependency model, TypeScript-first,
no external CSS framework.

## Installation

```bash
npm install @lembryo/voxsheet
```

`react` / `react-dom` (>=18) are peer dependencies.

## Quick start

`VoxSheet` is **controlled and transport-agnostic**: you own the data source
(`fetchRows`) and the domain state (`sort` / `filters` / `search`), the grid owns
the viewport, selection, editing buffer, and keyboard.

```tsx
import { useCallback, useState } from "react"
import { VoxSheet } from "@lembryo/voxsheet"
import type { Column, FetchResult, Query, SortSpec } from "@lembryo/voxsheet"
import "@lembryo/voxsheet/styles.css"

const columns: Column[] = [
  { name: "id", type: "number" },
  { name: "name", type: "string" },
  { name: "salary", type: "number", format: { kind: "number", options: { style: "currency", currency: "USD" } } },
  { name: "joinedAt", type: "date" },
]

export function App() {
  const [sort, setSort] = useState<SortSpec[]>([])
  const [total, setTotal] = useState(0)

  // The grid calls this with a Query (offset/limit + the controlled sort/filters/search)
  // and an AbortSignal it manages for stale-request cancellation.
  const fetchRows = useCallback(async (query: Query, signal: AbortSignal): Promise<FetchResult> => {
    const res = await fetch("/api/rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
      signal,
    })
    const json: FetchResult = await res.json()
    if (typeof json.total === "number") setTotal(json.total)
    return json
  }, [])

  return (
    <VoxSheet
      columns={columns}
      totalRows={total}
      fetchRows={fetchRows}
      sort={sort}
      onSortChange={setSort}
    />
  )
}
```

## Data contract

```ts
type CellValue = string | number | boolean | null

type Query = {
  offset: number
  limit: number
  sort: SortSpec[]      // multi-column, in priority order
  filters: FilterSpec[] // AND-combined
  search?: string
}

type FetchResult = {
  data: CellValue[][]   // data[i][j] = row i, column j (aligned to `columns`)
  ids: number[]         // stable row id (used to resolve edits on commit)
  ordinals: number[]    // display ordinal shown in the row-number gutter
  total?: number        // count after filters/search; syncs the scrollbar
}

type FetchRowsFn = (query: Query, signal: AbortSignal) => Promise<FetchResult>
```

A `Column` declares the type that drives formatting, alignment, parsing on edit,
and sort comparison:

```ts
type Column = {
  name: string                                   // identifier + display label
  type?: "string" | "number" | "date" | "boolean"
  align?: "left" | "right" | "center"            // defaults derived from type
  width?: number
  format?: ColumnFormat                          // Intl options or a function
  editable?: boolean | ((ctx: { row: number }) => boolean)
  validate?: (value: CellValue, ctx: { row: number }) => boolean | string
}
```

## Key props

| prop | type | notes |
|------|------|-------|
| `columns` | `Column[]` | required |
| `totalRows` | `number` | required; kept in sync via `FetchResult.total` |
| `fetchRows` | `FetchRowsFn` | required |
| `sort` / `filters` / `search` | controlled | reflected in the header / passed to `fetchRows` |
| `readOnly` | `boolean` | disables editing (copy / select / navigate still work) |
| `density` | `"compact" \| "normal" \| "comfortable"` | sets row height + font size |
| `rowHeight` | `number` | overrides density height |
| `theme` | `"light" \| "dark" \| "system"` | sets `data-vox-theme` |
| `labels` / `icons` / `platform` | partial overrides | i18n, icon set, clipboard/notify/confirm/saveFile |

### Callbacks (host events)

A button or affordance is **hidden when its callback is omitted** — e.g. the sort
button only appears when `onSortChange` is set, the filter button only when
`onFilterButtonClick` is set, the add-column button only when `onAddColumn` is set,
and header rename is enabled only when `onColumnRename` is set.

`onSortChange`, `onFilterButtonClick(col, anchorRect)`, `onColumnResize`,
`onColumnRename`, `onAddColumn`, `onCellChange`, `onDirtyChange`, `onAppendRow`,
`onInsertRow`, `onDeleteRows`, `onAutoFill`, `onSelectionChange`,
`onSelectionStats`, `onCellKeyDown`, `onError`.

### Imperative handle (`ref`)

```ts
type VoxSheetHandle = {
  scrollToRow(row): void
  scrollToCell(row, col): void
  focusCell(row, col): void
  getSelection(): Selection[]
  setSelection(sel: Selection[]): void
  startEdit(row, col): void
  getLocalEdits(): CellEdit[]   // pull uncommitted edits to persist
  clearLocalEdits(): void       // call after a successful commit
  undo(): void
  redo(): void
  invalidate(): void            // drop cache + refetch
}
```

Commit flow: edits stay in a local layer (dirty highlight, `onCellChange` /
`onDirtyChange`). The host commits by reading `getLocalEdits()`, resolving each
`row` to a stable id via the `ids` it captured from `fetchRows`, persisting, then
calling `clearLocalEdits()`.

## Keyboard

Arrows / Tab / Enter / Esc navigation, Home/End, PageUp/PageDown, Ctrl+Home/End,
F2 / direct typing / Delete to edit, `Ctrl+A/C/X/V`, `Ctrl+Z/Y`, Shift+arrows /
Shift+click to extend, Ctrl+click for multiple ranges. IME is committed on
`compositionend`. In `readOnly` only copy / select-all / navigation are active.

## Styling

Self-contained styles under `vox-` classes and `--vox-*` CSS variables; import
`@lembryo/voxsheet/styles.css`. Override variables (e.g. `--vox-row-height`,
`--vox-color-accent`) or class rules to theme. Dark mode follows
`prefers-color-scheme` and can be forced via the `theme` prop.

> Not yet implemented in this version: `frozenRows` (the prop is accepted but does
> not yet render a frozen band) and `frozenColumns` (v2).

## License

MIT
