# @lembryo/voxsheet

A virtual-scrolling **React spreadsheet / data grid** for millions of rows.

[![npm version](https://img.shields.io/npm/v/@lembryo/voxsheet.svg)](https://www.npmjs.com/package/@lembryo/voxsheet)
[![npm downloads](https://img.shields.io/npm/dm/@lembryo/voxsheet.svg)](https://www.npmjs.com/package/@lembryo/voxsheet)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@lembryo/voxsheet.svg)](https://bundlephobia.com/package/@lembryo/voxsheet)
[![types](https://img.shields.io/npm/types/@lembryo/voxsheet.svg)](https://www.npmjs.com/package/@lembryo/voxsheet)
[![license](https://img.shields.io/npm/l/@lembryo/voxsheet.svg)](./LICENSE)

Render millions of rows smoothly with DOM-based virtual scrolling. Excel-like
selection, editing, autofill, clipboard, column resize, and host-controlled
(server-driven) sort / filter / search. React component, peer-dependency model,
TypeScript-first, no external CSS framework.

*

*[📖 Documentation](https://lembryo.github.io/voxsheet/) · [▶ Live demo](https://lembryo.github.io/voxsheet/demo/) · [npm](https://www.npmjs.com/package/@lembryo/voxsheet)
**

## Why voxsheet?

voxsheet combines a **free (MIT) Excel-like editing experience** with a
**server-driven design** from day one.

- **Free Excel-like editing** — autofill (fill handle), multi-range selection,
  copy & paste, and column resizing built in.
- **Server-driven by design** — sort, filter, search, and pagination are
  delegated to your backend through `fetchRows`; even huge datasets fetch only
  the visible window.
- **React-native / DOM-based** — hooks, controlled props, JSX cells; extend and
  inspect with ordinary DOM (no canvas).
- **TypeScript-first, no external CSS, peer dependencies.**

Several of these features are paid or separately licensed in other major grids:

| Feature                | voxsheet           | Representative alternatives                       |
|------------------------|--------------------|---------------------------------------------------|
| Autofill (fill handle) | **Built in, free** | AG Grid: Enterprise (paid); MUI X: Premium (paid) |
| Multi-range selection  | **Built in, free** | AG Grid: Enterprise (paid)                        |
| Server-driven data     | **Built in**       | AG Grid: Enterprise (Server-Side Row Model)       |
| License                | **MIT**            | Handsontable: paid license for commercial use     |

> For breadth (row grouping, pivoting, frozen columns) and maturity, established
> grids such as AG Grid lead. voxsheet fits "React, free, Excel-like editing with
> a server-driven model done simply." If you need to be fully framework-agnostic,
> consider Web Component grids such as RevoGrid. Licenses change — verify current
> terms before adopting.

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
    data: CellValue[][]         // data[i][j] = row i, column j (aligned to `columns`)
    ids: number[]               // stable row id (used to resolve edits on commit)
    ordinals: (number | null)[] // display ordinal in the row-number gutter; null = blank gutter
    total?: number              // count after filters/search; syncs the scrollbar
}

type FetchRowsFn = (query: Query, signal: AbortSignal) => Promise<FetchResult>
```

**Row-number gutter.** The left gutter width auto-fits to the largest row number
(`totalRows`) by default, so `"1,000,000"` and `"100,000,000"` are never clipped;
set `rowHeaderWidth` to fix it or `autoRowHeaderWidth={false}` for the legacy 52px.
Return `ordinals[i] === null` to render a **blank** gutter for that row (e.g. a
frozen header row) while keeping the cell itself; `undefined` falls back to
`offset + i + 1`.

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
    sortModes?: { id: string; label: string }[]    // e.g. text vs numeric; adds a ▾ picker
    defaultSortMode?: string                       // initial mode id (defaults to sortModes[0])
}
```

### Sort modes

Some columns can be ordered more than one way — the same values may need a **text**
sort or a **numeric** sort. Declare the choices with `Column.sortModes` and the header
gains a small `▾` picker. The chosen mode id rides along on `SortSpec.mode`; **your
backend decides what it means** (the grid only carries the id, staying transport-agnostic).
Columns without `sortModes` behave exactly as before — no `mode` is sent, so the default
is your backend's plain (text) ordering.

```ts
type SortSpec = { column: string; direction: "asc" | "desc"; mode?: string }

const columns: Column[] = [
    {
        name: "code", sortModes: [
            { id: "text", label: "Text" },
            { id: "numeric", label: "Numeric" },
        ], defaultSortMode: "text"
    },
]
// fetchRows receives e.g. { column: "code", direction: "asc", mode: "numeric" };
// translate mode → ORDER BY on the server.
```

## Key props

| prop                            | type                                     | notes                                                      |
|---------------------------------|------------------------------------------|------------------------------------------------------------|
| `columns`                       | `Column[]`                               | required                                                   |
| `totalRows`                     | `number`                                 | required; kept in sync via `FetchResult.total`             |
| `fetchRows`                     | `FetchRowsFn`                            | required                                                   |
| `sort` / `filters` / `search`   | controlled                               | reflected in the header / passed to `fetchRows`            |
| `readOnly`                      | `boolean`                                | disables editing (copy / select / navigate still work)     |
| `frozenRows`                    | `number`                                 | freeze the first N rows to the top (default 0)             |
| `frozenColumns`                 | `number`                                 | freeze the first N columns to the left (default 0)         |
| `rowHeaderWidth`                | `number`                                 | row-number gutter width (px); auto-fit when omitted        |
| `autoRowHeaderWidth`            | `boolean`                                | auto-fit gutter width to `totalRows` digits (default true) |
| `density`                       | `"compact" \| "normal" \| "comfortable"` | sets row height + font size                                |
| `rowHeight`                     | `number`                                 | overrides density height                                   |
| `theme`                         | `"light" \| "dark" \| "system"`          | sets `data-vox-theme`                                      |
| `labels` / `icons` / `platform` | partial overrides                        | i18n, icon set, clipboard/notify/confirm/saveFile          |

### Callbacks (host events)

A button or affordance is **hidden when its callback is omitted** — e.g. the sort
button only appears when `onSortChange` is set, the filter button only when
`onFilterButtonClick` is set, the add-column button only when `onAddColumn` is set,
and header rename is enabled only when `onColumnRename` is set.

`onSortChange`, `onFilterButtonClick(col, anchorRect)`, `onColumnResize`,
`onColumnRename`, `onColumnReorder(from, to)`, `onAddColumn`, `onCellChange`,
`onDirtyChange`, `onAppendRow`, `onInsertRow`, `onDeleteRows`, `onAutoFill`,
`onSelectionChange`, `onSelectionStats`, `onCellKeyDown`, `onError`.

Dragging a column header emits `onColumnReorder(from, to)` (with an insertion
indicator during the drag); reflect the move by reordering `columns` — the order
is host-controlled. The filter button shows a small count badge when a column has
more than one active `FilterSpec`.

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

Commit flow: edits stay in a local layer (dirty tracking via `onCellChange` /
`onDirtyChange`; the dirty tint is off by default — see Styling). The host commits
by reading `getLocalEdits()`, resolving each
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

Edited (dirty) cells are **not** tinted by default (`--vox-color-dirty-bg` defaults to
`transparent`); set it to highlight uncommitted edits, per theme if desired (e.g. light
`rgba(212, 167, 44, 0.18)`, dark `rgba(187, 128, 9, 0.25)`).

> **Where to override variables:** the `--vox-*` variables are declared on the
> `.vox-sheet` root (not `:root`), so overriding them on `:root` has no effect.
> Scope your overrides to `.vox-sheet` (or a wrapper class), e.g.:
>
> ```css
> .vox-sheet { --vox-row-height: 32px; --vox-color-accent: #06c755; }
> ```

## License

MIT
