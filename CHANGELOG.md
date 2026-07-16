# @lembryo/voxsheet

## 1.2.0

### Minor Changes

- **Auto-fitting row-number gutter.** The left row-number column width now auto-fits
  to the largest displayable row number (derived from `totalRows`) instead of a fixed
  52px, so large counts such as `"1,000,000"` or `"100,000,000"` are no longer clipped.
  The computed width is the single source used everywhere it matters — the top-left
  corner, each row-number cell, the column X-offset origin, the horizontal scroll
  width, the `frozenColumns` sticky offset, and the `--vox-row-header-width` CSS
  variable — so widening it never misaligns headers and body cells. Two new props:
  `rowHeaderWidth` (explicit width, wins over auto) and `autoRowHeaderWidth` (default
  `true`; set `false` for the legacy fixed 52px). The width is clamped to 52–120px and
  recomputed when `totalRows` changes.
- **Blank gutter for chosen rows.** `FetchResult.ordinals[i]` now accepts `null` to
  render a **blank** row-number gutter for that row (the cell, borders, and height are
  kept — only the text is emptied). This lets a host blank the gutter of a frozen
  header row while numbering the data rows from 1. `undefined` keeps the previous
  `offset + i + 1` fallback, so the two are distinguished and existing callers are
  unaffected.
- **Edited-cell highlight off by default.** Editing or pasting no longer tints cells
  yellow: the dirty (uncommitted edit) background now defaults to `transparent`, so the
  cell keeps its normal color. The highlight stays fully configurable — override
  `--vox-color-dirty-bg` (per theme) to re-enable it (recommended light
  `rgba(212, 167, 44, 0.18)`, dark `rgba(187, 128, 9, 0.25)`). The dirty layer now sits
  beneath the selection / frozen-column / search backgrounds, so the transparent default
  never breaks them and an enabled highlight only tints plain cells. Dirty tracking
  itself (the `--dirty` class, `onDirtyChange`, `getLocalEdits`) is unchanged.

## 1.1.0

### Minor Changes

- **Row & column freezing.** `frozenRows` renders the first N rows in a fixed band
  above the scrolling body (only horizontal scroll syncs); the body covers rows
  `[frozenRows, total)` so frozen rows are never duplicated, and the leading
  chunk(s) covering them are always fetched. `frozenColumns` freezes the first N
  columns to the left with sticky positioning during horizontal scroll. The two
  compose (the top-left intersection stays pinned in both directions).
- **Per-column sort modes.** A `Column` can declare `sortModes` (`{ id, label }[]`)
  and an optional `defaultSortMode`; the header shows a `▾` picker so the user can
  choose *how* a column is ordered (e.g. text vs numeric). The chosen id rides on
  `SortSpec.mode`, which the host translates on the backend — the grid carries the
  id and holds no comparison rules. Columns without `sortModes` are unchanged (no
  `mode` sent), so this is fully backward compatible.
- **Column drag-and-drop reordering** via a new `onColumnReorder(from, to)`
  callback. Dragging a column header shows an insertion indicator and emits the
  move; the column order stays host-controlled (reflect it by reordering
  `columns`). Omitting the callback disables header dragging.
- **Filter-count badge.** The header filter button shows a count badge when a
  column has more than one active `FilterSpec`, so multi-condition filters are
  visible at a glance.
- **Loading & empty-state fixes.** The loading overlay now appears during any
  refetch that cleared the rows (e.g. sort/filter), not only on first load; and a
  query that returns `total: 0` now shows the empty state instead of blank rows.

## 1.0.0

- Initial public release: DOM-based virtual scrolling for millions of rows,
  Excel-like range selection / editing / autofill / clipboard / column resize,
  host-controlled (server-driven) sort / filter / search, imperative handle,
  `platform` adapter, icons, themes, and i18n.
