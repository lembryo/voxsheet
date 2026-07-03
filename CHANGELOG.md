# @lembryo/voxsheet

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
