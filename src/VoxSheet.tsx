import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import type { CSSProperties, ReactElement } from "react"
import type {
  CellEdit,
  CellValue,
  Selection,
  SortSpec,
  VoxSheetHandle,
  VoxSheetProps,
} from "./types"
import { useChunks } from "./hooks/useChunks"
import { useEditBuffer } from "./hooks/useEditBuffer"
import { defaultAlign, formatCellValue, numericValue, parseInputValue } from "./core/format"
import { cellInRects, normalizeRects, totalCellCount } from "./core/range"
import { buildTsv, parseTsv } from "./core/clipboard"
import { resolveIcons } from "./icons"
import { resolveLabels } from "./labels"
import { resolvePlatform } from "./platform"
import "./styles.css"

const DENSITY: Record<NonNullable<VoxSheetProps["density"]>, { rowHeight: number; fontSize: number }> = {
  compact: { rowHeight: 22, fontSize: 12 },
  normal: { rowHeight: 28, fontSize: 13 },
  comfortable: { rowHeight: 34, fontSize: 15 },
}

const ROW_HEADER_WIDTH = 52
const OVERSCAN = 8
const MIN_COL_WIDTH = 40
const MAX_AUTOFIT_WIDTH = 600
/** これを超えるセル数のコピー/集計は重いので抑止する（簡易ガード）。 */
const HEAVY_CELL_LIMIT = 100_000

type Cell = { row: number; col: number }

const cellToInput = (value: CellValue): string => (value === null ? "" : String(value))

/**
 * VoxSheet — DOM ベースの仮想スクロール対応スプレッドシート。
 * 連番列・選択・編集・オートフィル・ソート/フィルタのヘッダ UI を備える。
 */
const VoxSheetInner = (props: VoxSheetProps, ref: React.Ref<VoxSheetHandle>): ReactElement => {
  const {
    columns,
    totalRows,
    fetchRows,
    queryKey,
    density = "normal",
    defaultColumnWidth = 120,
    frozenRows = 0,
    theme = "system",
    className,
    style,
    readOnly = false,
    sort = [],
    filters = [],
    search,
    searchHighlights,
    currentSearchHit,
    renderLoading,
    renderEmpty,
    labels: labelOverrides,
    icons: iconOverrides,
    platform: platformOverride,
    onSortChange,
    onFilterButtonClick,
    onColumnResize,
    onColumnRename,
    onAddColumn,
    onCellChange,
    onDirtyChange,
    onAppendRow,
    onInsertRow,
    onDeleteRows,
    onAutoFill,
    onSelectionChange,
    onSelectionStats,
    onCellKeyDown,
    onError,
  } = props

  const labels = useMemo(() => resolveLabels(labelOverrides), [labelOverrides])
  const icons = useMemo(() => resolveIcons(iconOverrides), [iconOverrides])
  const platform = useMemo(() => resolvePlatform(platformOverride), [platformOverride])

  const rowHeight = props.rowHeight ?? DENSITY[density].rowHeight
  const fontSize = DENSITY[density].fontSize

  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const frozenRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  // --- 列幅（列名キーで記憶し、リネーム後も引き継ぐ） ---
  const [colWidths, setColWidths] = useState<number[]>([])
  const widthMemoryRef = useRef<Map<string, number>>(new Map())
  const prevNamesRef = useRef<string[] | null>(null)
  useEffect(() => {
    const memory = widthMemoryRef.current
    const prev = prevNamesRef.current
    if (prev && prev.length === columns.length) {
      prev.forEach((oldName, i) => {
        const newName = columns[i]?.name
        if (newName && newName !== oldName && memory.has(oldName)) {
          memory.set(newName, memory.get(oldName)!)
          memory.delete(oldName)
        }
      })
    }
    prevNamesRef.current = columns.map((c) => c.name)
    setColWidths(columns.map((c) => memory.get(c.name) ?? c.width ?? defaultColumnWidth))
  }, [columns, defaultColumnWidth])

  const getColWidth = useCallback(
    (i: number): number => colWidths[i] ?? columns[i]?.width ?? defaultColumnWidth,
    [colWidths, columns, defaultColumnWidth],
  )
  const applyColWidth = useCallback(
    (col: number, width: number) => {
      const w = Math.max(MIN_COL_WIDTH, Math.round(width))
      setColWidths((prev) => {
        const next = [...prev]
        next[col] = w
        return next
      })
      const name = columns[col]?.name
      if (name) widthMemoryRef.current.set(name, w)
      onColumnResize?.(col, w)
    },
    [columns, onColumnResize],
  )

  // --- ビューポート高さの追従 ---
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    setViewportHeight(el.clientHeight)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // --- 可視範囲 ---
  // frozenRows（先頭行の固定表示）は現状未対応。prop は受け付けるが描画には反映しない
  // （チャンク取得側へはヒントとして渡す）。固定バンドの描画は今後の実装。
  const bodyOffset = 0
  // ビューポートから必要な行範囲（＋オーバースキャンの余裕）を算出する。
  // 総数が未確定でもまず取得できるよう、ここでは totalRows でクランプしない。
  // 実際の描画範囲は取得後に判明する total でクランプする（下の visibleEnd）。
  const desiredStart = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
  const desiredEnd = Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN

  // --- データ取得（チャンク） ---
  const { rows, total, status, invalidate } = useChunks({
    fetchRows,
    totalRows,
    columns,
    sort,
    filters,
    search,
    queryKey,
    frozenRows,
    startRow: desiredStart,
    endRow: desiredEnd,
    onError,
  })

  // 描画範囲は「ビューポートの要求」と「判明している総数」の小さい方。
  // total はレスポンスの FetchResult.total で自己更新されるため、ホストが
  // totalRows を更新しなくても初回取得後に正しい行数まで広がる。
  const visibleStart = Math.min(desiredStart, Math.max(0, total - 1))
  const visibleEnd = Math.min(total, desiredEnd)

  // --- ローカル編集レイヤー ---
  const editBuffer = useEditBuffer({ onCellChange, onDirtyChange })

  const getBaseValue = useCallback(
    (r: number, c: number): CellValue => rows.get(r)?.values[c] ?? null,
    [rows],
  )
  const getRawValue = useCallback(
    (r: number, c: number): CellValue => {
      const edited = editBuffer.getEditedValue(r, c)
      return edited !== undefined ? edited : getBaseValue(r, c)
    },
    [editBuffer, getBaseValue],
  )
  const getCellText = useCallback(
    (r: number, c: number): string => {
      const col = columns[c]
      if (!col) return ""
      return formatCellValue(getRawValue(r, c), col, r)
    },
    [columns, getRawValue],
  )
  const applyEdits = useCallback(
    (edits: CellEdit[]) => editBuffer.applyEdits(edits, getBaseValue),
    [editBuffer, getBaseValue],
  )

  // --- 選択 ---
  const [selections, setSelections] = useState<Selection[]>([])
  const [activeCell, setActiveCell] = useState<Cell | null>(null)
  const selRects = useMemo(() => normalizeRects(selections), [selections])
  const selMin = selRects.length > 0 ? selRects[selRects.length - 1]! : null
  const activeRange = selections.length > 0 ? selections[selections.length - 1]! : null

  const setSelection = useCallback((sel: Selection | null) => {
    setSelections(sel ? [sel] : [])
  }, [])
  const updateActiveSelection = useCallback((sel: Selection) => {
    setSelections((prev) => (prev.length > 0 ? [...prev.slice(0, -1), sel] : [sel]))
  }, [])
  const addSelection = useCallback((sel: Selection) => {
    setSelections((prev) => [...prev, sel])
  }, [])

  const isDraggingRef = useRef(false)
  const isRowDraggingRef = useRef(false)
  const isColDraggingRef = useRef(false)
  const rowAnchorRef = useRef<number | null>(null)
  const colAnchorRef = useRef<number | null>(null)

  // --- 編集状態 ---
  const [editingCell, setEditingCell] = useState<Cell | null>(null)
  const [editValue, setEditValue] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)

  // --- ヘッダ名編集 ---
  const [editingHeader, setEditingHeader] = useState<number | null>(null)
  const [headerEditValue, setHeaderEditValue] = useState("")
  const headerInputRef = useRef<HTMLInputElement>(null)

  // --- オートフィル ---
  const [fillDragging, setFillDragging] = useState(false)
  const [fillTarget, setFillTarget] = useState<number | null>(null)

  // --- リサイズ ---
  const [resizingCol, setResizingCol] = useState<number | null>(null)
  const resizeStartXRef = useRef(0)
  const resizeStartWRef = useRef(0)

  // --- コンテキストメニュー ---
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  // --- 編集可否 ---
  const columnEditable = useCallback(
    (c: number, r: number): boolean => {
      if (readOnly) return false
      const e = columns[c]?.editable
      if (e === undefined) return true
      return typeof e === "function" ? e({ row: r }) : e
    },
    [columns, readOnly],
  )

  // --- 検索ハイライト ---
  const searchHitSet = useMemo(() => {
    const s = new Set<string>()
    searchHighlights?.forEach((h) => s.add(`${h.row}:${h.col}`))
    return s
  }, [searchHighlights])

  // currentSearchHit が変わったらスクロール
  useEffect(() => {
    const el = bodyRef.current
    if (!currentSearchHit || !el) return
    const targetTop = Math.max(0, (currentSearchHit.row - bodyOffset) * rowHeight)
    const viewH = el.clientHeight
    const st = el.scrollTop
    if (targetTop < st || targetTop > st + viewH - rowHeight) {
      el.scrollTop = Math.max(0, targetTop - viewH / 3)
    }
  }, [currentSearchHit, rowHeight, bodyOffset])

  // --- 選択の通知 ---
  useEffect(() => {
    onSelectionChange?.(selections)
  }, [selections, onSelectionChange])

  // --- 選択統計 ---
  useEffect(() => {
    if (!onSelectionStats) return
    if (selRects.length === 0) {
      onSelectionStats(null)
      return
    }
    const count = totalCellCount(selRects)
    if (count > HEAVY_CELL_LIMIT) {
      onSelectionStats({ count, numericCount: 0, sum: null, average: null })
      return
    }
    let numericCount = 0
    let sum = 0
    for (const rect of selRects) {
      for (let r = rect.r1; r <= rect.r2; r++) {
        for (let c = rect.c1; c <= rect.c2; c++) {
          const n = numericValue(getRawValue(r, c))
          if (n !== null) {
            sum += n
            numericCount++
          }
        }
      }
    }
    onSelectionStats({
      count,
      numericCount,
      sum: numericCount > 0 ? sum : null,
      average: numericCount > 0 ? sum / numericCount : null,
    })
  }, [selRects, rows, editBuffer.version, onSelectionStats, getRawValue])

  // --- スクロール（横方向はヘッダ/固定行へ同期） ---
  const handleScroll = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    if (headerRef.current) headerRef.current.scrollLeft = body.scrollLeft
    if (frozenRef.current) frozenRef.current.scrollLeft = body.scrollLeft
    setScrollTop(body.scrollTop)
  }, [])

  // --- 編集 ---
  const startEdit = useCallback(
    (r: number, c: number, initial?: string) => {
      if (!columnEditable(c, r)) return
      setCtxMenu(null)
      setEditingCell({ row: r, col: c })
      setEditValue(initial ?? cellToInput(getRawValue(r, c)))
    },
    [columnEditable, getRawValue],
  )
  const cancelEdit = useCallback(() => setEditingCell(null), [])
  const commitEdit = useCallback(() => {
    if (!editingCell) return
    const { row, col } = editingCell
    const column = columns[col]
    setEditingCell(null)
    if (!column) return
    const oldValue = getRawValue(row, col)
    const newValue = parseInputValue(editValue, column.type)
    if (column.validate) {
      const result = column.validate(newValue, { row })
      if (result === false || typeof result === "string") {
        platform.notify("error", typeof result === "string" ? result : "Invalid value")
        return
      }
    }
    if (newValue !== oldValue) {
      applyEdits([{ row, col, oldValue, newValue }])
    }
  }, [editingCell, columns, editValue, getRawValue, applyEdits, platform])

  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingCell])

  // --- セル操作 ---
  const handleCellMouseDown = useCallback(
    (r: number, c: number, e: React.MouseEvent) => {
      if (editingCell && editingCell.row === r && editingCell.col === c) return
      if (editingCell) commitEdit()
      setCtxMenu(null)
      if (e.shiftKey && activeCell) {
        updateActiveSelection({ start: activeCell, end: { row: r, col: c } })
      } else if (e.ctrlKey || e.metaKey) {
        setActiveCell({ row: r, col: c })
        addSelection({ start: { row: r, col: c }, end: { row: r, col: c } })
      } else {
        setActiveCell({ row: r, col: c })
        setSelection({ start: { row: r, col: c }, end: { row: r, col: c } })
      }
      isDraggingRef.current = true
    },
    [activeCell, editingCell, commitEdit, setSelection, updateActiveSelection, addSelection],
  )

  const handleCellMouseEnter = useCallback(
    (r: number, c: number) => {
      if (isDraggingRef.current && activeCell) {
        updateActiveSelection({ start: activeCell, end: { row: r, col: c } })
      }
      if (isRowDraggingRef.current && rowAnchorRef.current !== null) {
        updateActiveSelection({
          start: { row: rowAnchorRef.current, col: 0 },
          end: { row: r, col: columns.length - 1 },
        })
      }
      if (fillDragging) setFillTarget(r)
    },
    [activeCell, fillDragging, columns.length, updateActiveSelection],
  )

  // --- オートフィル適用 ---
  const applyFill = useCallback(() => {
    if (!activeRange || fillTarget === null) return
    const sr = Math.min(activeRange.start.row, activeRange.end.row)
    const er = Math.max(activeRange.start.row, activeRange.end.row)
    const sc = Math.min(activeRange.start.col, activeRange.end.col)
    const ec = Math.max(activeRange.start.col, activeRange.end.col)
    const te = Math.max(er, fillTarget)
    if (te <= er) return
    const edits: CellEdit[] = []
    for (let r = er + 1; r <= te; r++) {
      const srcR = sr + ((r - sr) % (er - sr + 1))
      for (let c = sc; c <= ec; c++) {
        if (!columnEditable(c, r)) continue
        edits.push({ row: r, col: c, oldValue: getRawValue(r, c), newValue: getRawValue(srcR, c) })
      }
    }
    applyEdits(edits)
    setSelection({ start: { row: sr, col: sc }, end: { row: te, col: ec } })
    onAutoFill?.({
      sourceRange: { start: { row: sr, col: sc }, end: { row: er, col: ec } },
      direction: "down",
      toEnd: false,
    })
  }, [activeRange, fillTarget, columnEditable, getRawValue, applyEdits, setSelection, onAutoFill])

  useEffect(() => {
    const up = () => {
      isDraggingRef.current = false
      isRowDraggingRef.current = false
      isColDraggingRef.current = false
      if (fillDragging && fillTarget !== null) applyFill()
      setFillDragging(false)
      setFillTarget(null)
    }
    window.addEventListener("mouseup", up)
    return () => window.removeEventListener("mouseup", up)
  }, [fillDragging, fillTarget, applyFill])

  const handleFillHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setFillDragging(true)
  }, [])

  // --- 行ヘッダ（行全体の選択） ---
  const fullRow = useCallback(
    (a: number, b: number): Selection => ({
      start: { row: a, col: 0 },
      end: { row: b, col: columns.length - 1 },
    }),
    [columns.length],
  )
  const handleRowHeaderMouseDown = useCallback(
    (r: number, e: React.MouseEvent) => {
      if (editingCell) commitEdit()
      setCtxMenu(null)
      if (e.shiftKey && rowAnchorRef.current !== null) {
        updateActiveSelection(fullRow(rowAnchorRef.current, r))
      } else if (e.ctrlKey || e.metaKey) {
        rowAnchorRef.current = r
        setActiveCell({ row: r, col: 0 })
        addSelection(fullRow(r, r))
      } else {
        rowAnchorRef.current = r
        setActiveCell({ row: r, col: 0 })
        setSelection(fullRow(r, r))
      }
      isRowDraggingRef.current = true
    },
    [editingCell, commitEdit, fullRow, setSelection, updateActiveSelection, addSelection],
  )

  // --- 列ヘッダ（列全体の選択） ---
  const fullCol = useCallback(
    (a: number, b: number): Selection => ({
      start: { row: 0, col: a },
      end: { row: total - 1, col: b },
    }),
    [total],
  )
  const handleColHeaderMouseDown = useCallback(
    (c: number, e: React.MouseEvent) => {
      if (editingHeader !== null) return
      if (editingCell) commitEdit()
      setCtxMenu(null)
      if (e.shiftKey && colAnchorRef.current !== null) {
        updateActiveSelection(fullCol(colAnchorRef.current, c))
      } else if (e.ctrlKey || e.metaKey) {
        colAnchorRef.current = c
        setActiveCell({ row: 0, col: c })
        addSelection(fullCol(c, c))
      } else {
        colAnchorRef.current = c
        setActiveCell({ row: 0, col: c })
        setSelection(fullCol(c, c))
      }
      isColDraggingRef.current = true
    },
    [editingHeader, editingCell, commitEdit, fullCol, setSelection, updateActiveSelection, addSelection],
  )
  const handleColHeaderMouseEnter = useCallback(
    (c: number) => {
      if (isColDraggingRef.current && colAnchorRef.current !== null) {
        updateActiveSelection(fullCol(colAnchorRef.current, c))
      }
    },
    [fullCol, updateActiveSelection],
  )

  const handleSelectAll = useCallback(() => {
    if (editingCell) commitEdit()
    setActiveCell({ row: 0, col: 0 })
    setSelection({ start: { row: 0, col: 0 }, end: { row: total - 1, col: columns.length - 1 } })
  }, [editingCell, commitEdit, total, columns.length, setSelection])

  // --- ヘッダ名編集 ---
  const startHeaderEdit = useCallback(
    (c: number) => {
      if (!onColumnRename) return
      setEditingCell(null)
      setSelection(null)
      setActiveCell(null)
      setEditingHeader(c)
      setHeaderEditValue(columns[c]?.name ?? "")
    },
    [onColumnRename, columns, setSelection],
  )
  const commitHeaderEdit = useCallback(() => {
    if (editingHeader === null) return
    const name = headerEditValue.trim()
    if (name && name !== columns[editingHeader]?.name) onColumnRename?.(editingHeader, name)
    setEditingHeader(null)
  }, [editingHeader, headerEditValue, columns, onColumnRename])
  useEffect(() => {
    if (editingHeader !== null && headerInputRef.current) {
      headerInputRef.current.focus()
      headerInputRef.current.select()
    }
  }, [editingHeader])

  // --- ソート（none→asc→desc→なし のトグル） ---
  const handleSortClick = useCallback(
    (c: number) => {
      const name = columns[c]?.name
      if (!name || !onSortChange) return
      const current = sort.find((s) => s.column === name)
      let next: SortSpec[]
      if (!current) next = [...sort, { column: name, direction: "asc" }]
      else if (current.direction === "asc")
        next = sort.map((s) => (s.column === name ? { ...s, direction: "desc" } : s))
      else next = sort.filter((s) => s.column !== name)
      onSortChange(next)
    },
    [columns, onSortChange, sort],
  )

  const handleFilterClick = useCallback(
    (c: number, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!onFilterButtonClick) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      onFilterButtonClick(c, rect)
    },
    [onFilterButtonClick],
  )

  // --- リサイズ ---
  const handleResizeStart = useCallback(
    (c: number, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setResizingCol(c)
      resizeStartXRef.current = e.clientX
      resizeStartWRef.current = getColWidth(c)
    },
    [getColWidth],
  )
  useEffect(() => {
    if (resizingCol === null) return
    const move = (e: MouseEvent) => {
      applyColWidth(resizingCol, resizeStartWRef.current + (e.clientX - resizeStartXRef.current))
    }
    const up = () => setResizingCol(null)
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    return () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
    }
  }, [resizingCol, applyColWidth])

  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const autoFitColumn = useCallback(
    (c: number) => {
      if (!measureCanvasRef.current) measureCanvasRef.current = document.createElement("canvas")
      const ctx = measureCanvasRef.current.getContext("2d")
      if (!ctx) return
      const sample = bodyRef.current?.querySelector(".vox-cell")
      if (sample) {
        const cs = getComputedStyle(sample)
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      } else {
        ctx.font = `${fontSize}px sans-serif`
      }
      let max = ctx.measureText(columns[c]?.name ?? "").width + 48
      rows.forEach((_, r) => {
        const text = getCellText(r, c)
        if (text) max = Math.max(max, ctx.measureText(text).width)
      })
      applyColWidth(c, Math.min(MAX_AUTOFIT_WIDTH, max + 16))
    },
    [columns, rows, getCellText, applyColWidth, fontSize],
  )

  // --- クリップボード ---
  const handleCopy = useCallback(async () => {
    if (selRects.length === 0) return
    if (totalCellCount(selRects) > HEAVY_CELL_LIMIT) {
      platform.notify("error", "Selection is too large to copy")
      return
    }
    try {
      await platform.writeText(buildTsv(selRects, getCellText))
    } catch (err) {
      onError?.(err, { phase: "commit" })
    }
  }, [selRects, platform, getCellText, onError])

  const handleCut = useCallback(async () => {
    if (readOnly) return
    await handleCopy()
    if (selRects.length === 0 || totalCellCount(selRects) > HEAVY_CELL_LIMIT) return
    const edits: CellEdit[] = []
    const seen = new Set<string>()
    for (const rect of selRects) {
      for (let r = rect.r1; r <= rect.r2; r++) {
        for (let c = rect.c1; c <= rect.c2; c++) {
          const key = `${r}:${c}`
          if (seen.has(key) || !columnEditable(c, r)) continue
          seen.add(key)
          edits.push({ row: r, col: c, oldValue: getRawValue(r, c), newValue: null })
        }
      }
    }
    applyEdits(edits)
  }, [readOnly, handleCopy, selRects, columnEditable, getRawValue, applyEdits])

  const handlePaste = useCallback(async () => {
    if (readOnly || !activeCell) return
    try {
      const text = await platform.readText()
      const grid = parseTsv(text)
      const edits: CellEdit[] = []
      for (let ri = 0; ri < grid.length; ri++) {
        const line = grid[ri]!
        for (let ci = 0; ci < line.length; ci++) {
          const tr = activeCell.row + ri
          const tc = activeCell.col + ci
          if (tr >= total || tc >= columns.length || !columnEditable(tc, tr)) continue
          edits.push({
            row: tr,
            col: tc,
            oldValue: getRawValue(tr, tc),
            newValue: parseInputValue(line[ci] ?? "", columns[tc]?.type),
          })
        }
      }
      applyEdits(edits)
    } catch (err) {
      onError?.(err, { phase: "commit" })
    }
  }, [readOnly, activeCell, platform, total, columns, columnEditable, getRawValue, applyEdits, onError])

  // --- キーボード ---
  const moveActive = useCallback(
    (nr: number, nc: number, extend: boolean) => {
      const row = Math.max(0, Math.min(total - 1, nr))
      const col = Math.max(0, Math.min(columns.length - 1, nc))
      setActiveCell({ row, col })
      if (extend && activeRange) {
        updateActiveSelection({ start: activeRange.start, end: { row, col } })
      } else {
        setSelection({ start: { row, col }, end: { row, col } })
      }
      // 可視範囲外なら追従スクロール
      const el = bodyRef.current
      if (el) {
        const top = (row - bodyOffset) * rowHeight
        if (top < el.scrollTop) el.scrollTop = top
        else if (top + rowHeight > el.scrollTop + el.clientHeight)
          el.scrollTop = top + rowHeight - el.clientHeight
      }
    },
    [total, columns.length, activeRange, updateActiveSelection, setSelection, bodyOffset, rowHeight],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingHeader !== null) return
      if (activeCell && onCellKeyDown) {
        const column = columns[activeCell.col]
        if (column) {
          onCellKeyDown(e, {
            row: activeCell.row,
            col: activeCell.col,
            value: getRawValue(activeCell.row, activeCell.col),
            column,
          })
          if (e.defaultPrevented) return
        }
      }

      const mod = e.ctrlKey || e.metaKey
      if (mod && !editingCell) {
        if (e.key === "a") {
          e.preventDefault()
          handleSelectAll()
          return
        }
        if (e.key === "c") {
          e.preventDefault()
          void handleCopy()
          return
        }
        if (!readOnly && e.key === "x") {
          e.preventDefault()
          void handleCut()
          return
        }
        if (!readOnly && e.key === "v") {
          e.preventDefault()
          void handlePaste()
          return
        }
        if (!readOnly && e.key === "z") {
          e.preventDefault()
          editBuffer.undo()
          return
        }
        if (!readOnly && e.key === "y") {
          e.preventDefault()
          editBuffer.redo()
          return
        }
      }

      if (editingCell) {
        if (e.key === "Enter" && !composingRef.current) {
          e.preventDefault()
          commitEdit()
          moveActive(editingCell.row + 1, editingCell.col, false)
        } else if (e.key === "Escape") {
          e.preventDefault()
          cancelEdit()
        } else if (e.key === "Tab") {
          e.preventDefault()
          commitEdit()
          moveActive(editingCell.row, editingCell.col + (e.shiftKey ? -1 : 1), false)
        }
        return
      }

      if (!activeCell) return
      if (readOnly && !e.key.startsWith("Arrow") && e.key !== "Tab") return
      const { row: r, col: c } = activeCell
      const extend = e.shiftKey && e.key.startsWith("Arrow")
      if (e.key === "ArrowDown") {
        e.preventDefault()
        moveActive(r + 1, c, extend)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        moveActive(r - 1, c, extend)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        moveActive(r, c + 1, extend)
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        moveActive(r, c - 1, extend)
      } else if (e.key === "Tab") {
        e.preventDefault()
        moveActive(r, c + (e.shiftKey ? -1 : 1), false)
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (r >= total - 1) onAppendRow?.(total)
        else moveActive(r + 1, c, false)
      } else if (e.key === "Home") {
        e.preventDefault()
        moveActive(r, mod ? 0 : 0, extend)
        if (mod) moveActive(0, 0, extend)
      } else if (e.key === "End") {
        e.preventDefault()
        if (mod) moveActive(total - 1, columns.length - 1, extend)
        else moveActive(r, columns.length - 1, extend)
      } else if (e.key === "PageDown") {
        e.preventDefault()
        moveActive(r + Math.floor(viewportHeight / rowHeight), c, extend)
      } else if (e.key === "PageUp") {
        e.preventDefault()
        moveActive(r - Math.floor(viewportHeight / rowHeight), c, extend)
      } else if (!readOnly && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault()
        startEdit(r, c, "")
      } else if (!readOnly && e.key === "F2") {
        e.preventDefault()
        startEdit(r, c)
      } else if (!readOnly && e.key.length === 1 && !mod && !e.altKey) {
        startEdit(r, c, e.key)
      }
    },
    [
      editingHeader,
      activeCell,
      onCellKeyDown,
      columns,
      getRawValue,
      editingCell,
      readOnly,
      handleSelectAll,
      handleCopy,
      handleCut,
      handlePaste,
      editBuffer,
      commitEdit,
      cancelEdit,
      moveActive,
      total,
      onAppendRow,
      viewportHeight,
      rowHeight,
      startEdit,
    ],
  )

  // --- コンテキストメニュー ---
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      setCtxMenu({ x: e.clientX, y: e.clientY })
    },
    [readOnly],
  )
  const deleteSelectedRows = useCallback(() => {
    if (selRects.length === 0) return
    const set = new Set<number>()
    for (const rect of selRects) for (let r = rect.r1; r <= rect.r2; r++) set.add(r)
    onDeleteRows?.(Array.from(set).sort((a, b) => a - b))
  }, [selRects, onDeleteRows])

  // --- 命令的ハンドル ---
  useImperativeHandle(
    ref,
    (): VoxSheetHandle => ({
      scrollToRow: (row) => {
        if (bodyRef.current) bodyRef.current.scrollTop = Math.max(0, (row - bodyOffset) * rowHeight)
      },
      scrollToCell: (row, col) => {
        if (bodyRef.current) bodyRef.current.scrollTop = Math.max(0, (row - bodyOffset) * rowHeight)
        let left = 0
        for (let i = 0; i < col; i++) left += getColWidth(i)
        if (bodyRef.current) bodyRef.current.scrollLeft = left
      },
      focusCell: (row, col) => {
        setActiveCell({ row, col })
        setSelection({ start: { row, col }, end: { row, col } })
        rootRef.current?.focus()
      },
      getSelection: () => selections,
      setSelection: (sel) => setSelections(sel),
      startEdit: (row, col) => startEdit(row, col),
      getLocalEdits: () => editBuffer.getLocalEdits(),
      clearLocalEdits: () => editBuffer.clear(),
      undo: () => editBuffer.undo(),
      redo: () => editBuffer.redo(),
      invalidate: () => invalidate(),
    }),
    [bodyOffset, rowHeight, getColWidth, selections, setSelection, startEdit, editBuffer, invalidate],
  )

  // --- レンダリング ---
  const headerWidth = ROW_HEADER_WIDTH + columns.reduce((sum, _, i) => sum + getColWidth(i), 0)
  const totalHeight = Math.max(0, total - bodyOffset) * rowHeight
  const fillRow = selMin ? selMin.r2 : null
  const fillCol = selMin ? selMin.c2 : null

  const renderHeaderActions = (c: number): ReactElement | null => {
    if (readOnly || (!onSortChange && !onFilterButtonClick)) return null
    const name = columns[c]?.name ?? ""
    const sortIndex = sort.findIndex((s) => s.column === name)
    const sortSpec = sortIndex >= 0 ? sort[sortIndex] : undefined
    const hasFilter = filters.some((f) => f.column === name)
    const SortIcon = sortSpec
      ? sortSpec.direction === "asc"
        ? icons.sortAscending
        : icons.sortDescending
      : icons.sortUnsorted
    const FilterIcon = hasFilter ? icons.filterActive : icons.filter
    return (
      <span className="vox-header-actions" onMouseDown={(e) => e.stopPropagation()}>
        {onFilterButtonClick && (
          <button
            type="button"
            className="vox-header-btn"
            title="Filter"
            aria-label={`Filter ${name}`}
            onClick={(e) => handleFilterClick(c, e)}
          >
            <FilterIcon size={13} />
          </button>
        )}
        {onSortChange && (
          <button
            type="button"
            className="vox-header-btn"
            title="Sort"
            aria-label={`Sort ${name}`}
            onClick={(e) => {
              e.stopPropagation()
              handleSortClick(c)
            }}
          >
            <SortIcon size={13} />
            {sortSpec && sort.length > 1 && <sup>{sortIndex + 1}</sup>}
          </button>
        )}
      </span>
    )
  }

  const renderRow = (rowIdx: number, top: number): ReactElement => {
    const entry = rows.get(rowIdx)
    const rowSelected = selRects.some(
      (rect) =>
        rowIdx >= rect.r1 && rowIdx <= rect.r2 && rect.c1 === 0 && rect.c2 === columns.length - 1,
    )
    const ordinal = entry ? Math.floor(entry.ordinal) : rowIdx + 1
    return (
      <div key={rowIdx} className="vox-row" style={{ top, height: rowHeight }} aria-rowindex={rowIdx + 1}>
        <div
          className={`vox-row-header${rowSelected ? " vox-row-header--selected" : ""}`}
          style={{ width: ROW_HEADER_WIDTH, height: rowHeight }}
          onMouseDown={(e) => handleRowHeaderMouseDown(rowIdx, e)}
          onMouseEnter={() =>
            isRowDraggingRef.current &&
            rowAnchorRef.current !== null &&
            updateActiveSelection(fullRow(rowAnchorRef.current, rowIdx))
          }
        >
          {ordinal.toLocaleString()}
        </div>
        {columns.map((col, c) => {
          const selected = cellInRects(selRects, rowIdx, c)
          const isActive = activeCell?.row === rowIdx && activeCell?.col === c
          const isEditing = editingCell?.row === rowIdx && editingCell?.col === c
          const dirty = editBuffer.isDirty(rowIdx, c)
          const hit = searchHitSet.has(`${rowIdx}:${c}`)
          const isCurrent = currentSearchHit?.row === rowIdx && currentSearchHit?.col === c
          const showFill =
            !fillDragging && rowIdx === fillRow && c === fillCol && selMin !== null && !readOnly
          const isFillPreview =
            fillDragging &&
            fillTarget !== null &&
            selMin !== null &&
            rowIdx > selMin.r2 &&
            rowIdx <= fillTarget &&
            c >= selMin.c1 &&
            c <= selMin.c2
          const align = col.align ?? defaultAlign(col.type)
          const cls =
            "vox-cell" +
            (selected ? " vox-cell--selected" : "") +
            (isActive ? " vox-cell--active" : "") +
            (dirty ? " vox-cell--dirty" : "") +
            (isFillPreview ? " vox-cell--selected" : "") +
            (hit ? " vox-cell--search-hit" : "") +
            (isCurrent ? " vox-cell--search-current" : "")
          return (
            <div
              key={c}
              className={cls}
              role="gridcell"
              aria-selected={selected}
              aria-colindex={c + 1}
              style={{ width: getColWidth(c), height: rowHeight, justifyContent: alignToJustify(align) }}
              onMouseDown={(e) => handleCellMouseDown(rowIdx, c, e)}
              onMouseEnter={() => handleCellMouseEnter(rowIdx, c)}
              onDoubleClick={() => startEdit(rowIdx, c)}
              onContextMenu={handleContextMenu}
            >
              {isEditing ? (
                <input
                  ref={editInputRef}
                  className="vox-cell-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onCompositionStart={() => (composingRef.current = true)}
                  onCompositionEnd={() => (composingRef.current = false)}
                />
              ) : (
                getCellText(rowIdx, c)
              )}
              {showFill && <div className="vox-fill-handle" onMouseDown={handleFillHandleMouseDown} />}
            </div>
          )
        })}
      </div>
    )
  }

  const bodyRows: ReactElement[] = []
  for (let r = visibleStart; r < visibleEnd; r++) {
    bodyRows.push(renderRow(r, (r - bodyOffset) * rowHeight))
  }

  const rootStyle: CSSProperties = {
    ["--vox-row-height" as string]: `${rowHeight}px`,
    ["--vox-font-size" as string]: `${fontSize}px`,
    ["--vox-row-header-width" as string]: `${ROW_HEADER_WIDTH}px`,
    ...style,
  }

  const isEmpty = total === 0 && status !== "loading"

  return (
    <div
      ref={rootRef}
      className={`vox-sheet${className ? ` ${className}` : ""}`}
      data-vox-theme={theme === "system" ? undefined : theme}
      role="grid"
      aria-rowcount={total}
      aria-colcount={columns.length}
      aria-readonly={readOnly}
      tabIndex={0}
      style={rootStyle}
      onKeyDown={handleKeyDown}
      onContextMenu={readOnly ? (e) => e.preventDefault() : undefined}
    >
      <div className="vox-header-wrap">
        <div className="vox-corner" style={{ width: ROW_HEADER_WIDTH }} onClick={handleSelectAll} />
        <div className="vox-header" ref={headerRef} role="row">
          {columns.map((col, c) => {
            const colSelected = selRects.some(
              (rect) => c >= rect.c1 && c <= rect.c2 && rect.r1 === 0 && rect.r2 === total - 1,
            )
            const sortName = col.name
            const sortSpec = sort.find((s) => s.column === sortName)
            return (
              <div
                key={c}
                className="vox-header-cell"
                role="columnheader"
                aria-colindex={c + 1}
                aria-sort={
                  sortSpec ? (sortSpec.direction === "asc" ? "ascending" : "descending") : "none"
                }
                style={{
                  width: getColWidth(c),
                  background: colSelected ? "var(--vox-color-selection-bg)" : undefined,
                }}
                onMouseDown={(e) => handleColHeaderMouseDown(c, e)}
                onMouseEnter={() => handleColHeaderMouseEnter(c)}
              >
                {editingHeader === c ? (
                  <input
                    ref={headerInputRef}
                    className="vox-cell-input"
                    value={headerEditValue}
                    onChange={(e) => setHeaderEditValue(e.target.value)}
                    onBlur={commitHeaderEdit}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        commitHeaderEdit()
                      } else if (e.key === "Escape") {
                        e.preventDefault()
                        setEditingHeader(null)
                      }
                    }}
                  />
                ) : (
                  <span
                    className="vox-header-label"
                    onDoubleClick={
                      onColumnRename
                        ? (e) => {
                            e.stopPropagation()
                            startHeaderEdit(c)
                          }
                        : undefined
                    }
                  >
                    {col.name}
                  </span>
                )}
                {renderHeaderActions(c)}
                <div
                  className="vox-resize-handle"
                  onMouseDown={(e) => handleResizeStart(c, e)}
                  onDoubleClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    autoFitColumn(c)
                  }}
                />
              </div>
            )
          })}
          {onAddColumn && (
            <button
              type="button"
              className="vox-add-column"
              title="Add column"
              onClick={() => onAddColumn(columns.length)}
            >
              +
            </button>
          )}
        </div>
      </div>

      <div className="vox-body" ref={bodyRef} onScroll={handleScroll}>
        <div className="vox-scroll-spacer" style={{ height: totalHeight, width: headerWidth }}>
          {bodyRows}
        </div>
      </div>

      {status === "loading" && total === 0 && (
        <div className="vox-overlay">{renderLoading ? renderLoading() : labels.loading}</div>
      )}
      {isEmpty && <div className="vox-overlay">{renderEmpty ? renderEmpty() : labels.empty}</div>}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: labels.contextCut, action: () => void handleCut(), disabled: !selMin },
            { label: labels.contextCopy, action: () => void handleCopy(), disabled: !selMin },
            { label: labels.contextPaste, action: () => void handlePaste(), disabled: !activeCell },
            ...(onInsertRow
              ? ([
                  "sep" as const,
                  {
                    label: labels.contextInsertRowAbove,
                    action: () => activeCell && onInsertRow(activeCell.row, "above"),
                    disabled: !activeCell,
                  },
                  {
                    label: labels.contextInsertRowBelow,
                    action: () => activeCell && onInsertRow(activeCell.row, "below"),
                    disabled: !activeCell,
                  },
                ] as const)
              : []),
            ...(onDeleteRows
              ? ([
                  "sep" as const,
                  {
                    label: labels.contextDeleteRows,
                    action: deleteSelectedRows,
                    disabled: selRects.length === 0,
                  },
                ] as const)
              : []),
            "sep" as const,
            { label: labels.contextUndo, action: () => editBuffer.undo(), disabled: !editBuffer.canUndo() },
            { label: labels.contextRedo, action: () => editBuffer.redo(), disabled: !editBuffer.canRedo() },
          ]}
        />
      )}
    </div>
  )
}

const alignToJustify = (align: "left" | "right" | "center"): string =>
  align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start"

type CtxItem = { label: string; action: () => void; disabled?: boolean }

const ContextMenu = ({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: (CtxItem | "sep")[]
  onClose: () => void
}): ReactElement => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [onClose])
  return (
    <div ref={ref} className="vox-context-menu" style={{ left: x, top: y }} role="menu">
      {items.map((item, i) =>
        item === "sep" ? (
          <div key={i} className="vox-context-separator" />
        ) : (
          <button
            key={i}
            type="button"
            className="vox-context-item"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.action()
              onClose()
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  )
}

export const VoxSheet = forwardRef<VoxSheetHandle, VoxSheetProps>(VoxSheetInner)
