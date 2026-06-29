import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode,
} from "react"

/**
 * セル値。JSON シリアライズ可能な型に限定する。
 * - 日付は ISO 8601 文字列（推奨）または epoch ミリ秒で運び、列 type='date' で解釈する。
 * - null は SQL NULL を表現し、空文字 "" と区別する。
 */
export type CellValue = string | number | boolean | null

export type ColumnType = "string" | "number" | "date" | "boolean"
export type ColumnAlign = "left" | "right" | "center"

/** 列の表示整形。関数 > kind 別既定 の順で解決する。 */
export type ColumnFormat =
  | { kind: "number"; options: Intl.NumberFormatOptions }
  | { kind: "date"; options: Intl.DateTimeFormatOptions }
  | ((value: CellValue, ctx: { column: Column; row: number }) => string)

/** 列メタデータ。型は列が宣言し、描画・編集・比較・オートフィルを駆動する。 */
export type Column = {
  /** 識別子兼表示名（sort/filter の column 参照に使用） */
  name: string
  /** 既定 "string" */
  type?: ColumnType
  /** 既定は type から導出（number/date=right, boolean=center） */
  align?: ColumnAlign
  /** 既定は defaultColumnWidth。ユーザリサイズは列名キーで記憶する */
  width?: number
  format?: ColumnFormat
  /** 既定は親 readOnly に従う */
  editable?: boolean | ((ctx: { row: number }) => boolean)
  /** false / 文字列で却下 */
  validate?: (value: CellValue, ctx: { row: number }) => boolean | string
}

export type SortDirection = "asc" | "desc"
/** 配列順 = 多列ソートの優先順位 */
export type SortSpec = { column: string; direction: SortDirection }

export type FilterOperator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isNull"
  | "notNull"
export type FilterSpec = { column: string; operator: FilterOperator; value?: CellValue }

/** fetchRows に渡すクエリ。offset/limit はグリッド所有、sort/filters/search は controlled。 */
export type Query = {
  offset: number
  limit: number
  sort: SortSpec[]
  filters: FilterSpec[]
  search?: string
}

/**
 * チャンク取得の戻り値。
 * data[i][j] = i 行目 j 列目、ids[i] が行 ID、ordinals[i] が表示順序。
 * total はフィルタ適用後の総件数（毎回返すのが望ましい）。
 */
export type FetchResult = {
  data: CellValue[][]
  ids: number[]
  ordinals: number[]
  total?: number
}

/** 行データを範囲指定で取得する関数。signal で陳腐化した取得を中断できる。 */
export type FetchRowsFn = (query: Query, signal: AbortSignal) => Promise<FetchResult>

export type CellAddress = { row: number; col: number }
/** 矩形選択。配列で複数レンジ（Excel 風）。 */
export type Selection = { start: CellAddress; end: CellAddress }
export type SelectionStats = {
  count: number
  numericCount: number
  sum: number | null
  average: number | null
}

export type CellEdit = { row: number; col: number; oldValue: CellValue; newValue: CellValue }
/** 1 操作（ペースト/オートフィル/カット）= Undo の単位。 */
export type EditAction = { edits: CellEdit[] }

/** onCellKeyDown に渡す文脈。 */
export type CellContext = { row: number; col: number; value: CellValue; column: Column }

// --- アイコン ---

export type IconName = "sortAscending" | "sortDescending" | "sortUnsorted" | "filter" | "filterActive"
export type IconProps = { size?: number; className?: string }
export type IconRenderer = (props: IconProps) => ReactElement
export type Icons = Partial<Record<IconName, IconRenderer>>

// --- 国際化（内蔵 UI 文言） ---

export type VoxLabels = {
  loading: string
  empty: string
  contextCut: string
  contextCopy: string
  contextPaste: string
  contextInsertRowAbove: string
  contextInsertRowBelow: string
  contextDeleteRows: string
  contextUndo: string
  contextRedo: string
  confirmLargeCopyTitle: string
  confirmLargeCopyMessage: string
  confirmOk: string
  confirmCancel: string
}

// --- プラットフォームアダプタ ---

export type ToastKind = "loading" | "success" | "error" | "info"
export type ConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
}
export type PlatformAdapter = {
  clipboard?: {
    readText?: () => Promise<string>
    writeText?: (text: string) => Promise<void>
  }
  notify?: (
    kind: ToastKind,
    message: string,
    opts?: { id?: string; durationMs?: number },
  ) => string
  confirm?: (opts: ConfirmOptions) => Promise<boolean>
  saveFile?: (opts: { suggestedName: string; mimeType?: string; data: string | Blob }) => Promise<void>
}

/** 命令的ハンドル（ref 経由）。 */
export type VoxSheetHandle = {
  scrollToRow: (row: number) => void
  scrollToCell: (row: number, col: number) => void
  focusCell: (row: number, col: number) => void
  getSelection: () => Selection[]
  setSelection: (sel: Selection[]) => void
  startEdit: (row: number, col: number) => void
  /** 未コミット編集の取り出し */
  getLocalEdits: () => CellEdit[]
  /** コミット後にローカル編集と Undo/Redo をクリア */
  clearLocalEdits: () => void
  undo: () => void
  redo: () => void
  /** キャッシュ破棄＋再取得（queryKey を使わない明示リフレッシュ） */
  invalidate: () => void
}

export type VoxSheetProps = {
  // --- データ（層3） ---
  /** 列定義（controlled）。表示/非表示は配列から除外で表現する。 */
  columns: Column[]
  /** 総行数。FetchResult.total で同期する。 */
  totalRows: number
  /** 行取得 (query, signal) => Promise<FetchResult> */
  fetchRows: FetchRowsFn
  /** ホスト独自クエリ入力の無効化キー */
  queryKey?: unknown

  // --- レイアウト・表示 ---
  /** 行の高さ(px)。既定 28。density より優先。 */
  rowHeight?: number
  /** フォントと行高をセットで切替。既定 "normal"。 */
  density?: "compact" | "normal" | "comfortable"
  /** 列幅既定(px)。既定 120。 */
  defaultColumnWidth?: number
  /** 先頭から固定する行数。既定 0。 */
  frozenRows?: number
  /** data-vox-theme を設定。既定 "system"。 */
  theme?: "light" | "dark" | "system"
  className?: string
  style?: CSSProperties

  // --- 振る舞い（controlled ドメイン状態） ---
  /** 編集 UI 無効（コピー・選択・ナビは可）。 */
  readOnly?: boolean
  /** 多列ソート（controlled）。 */
  sort?: SortSpec[]
  /** フィルタ（controlled・条件 UI はホスト所有）。 */
  filters?: FilterSpec[]
  /** 検索キーワード。 */
  search?: string
  /** ハイライト対象セル。 */
  searchHighlights?: CellAddress[]
  /** 現在ヒット。変化でスクロールする。 */
  currentSearchHit?: CellAddress | null

  // --- 状態 UI・拡張 ---
  renderLoading?: () => ReactNode
  renderEmpty?: () => ReactNode
  labels?: Partial<VoxLabels>
  icons?: Icons
  platform?: PlatformAdapter

  // --- イベント（層3） ---
  /** none→asc→desc をグリッドがトグルし通知。未指定でソートボタン非表示。 */
  onSortChange?: (sort: SortSpec[]) => void
  /** フィルタ操作要求（ホストがポップオーバー表示）。未指定でフィルタボタン非表示。 */
  onFilterButtonClick?: (col: number, anchor: DOMRect) => void
  /** 列幅変更（ドラッグ/ダブルクリック自動フィット）。 */
  onColumnResize?: (col: number, width: number) => void
  /** ヘッダ名編集。未指定でリネーム無効。 */
  onColumnRename?: (col: number, newName: string) => void
  /** 列追加要求。未指定で追加ボタン非表示。 */
  onAddColumn?: (atCol: number) => void
  /** ローカル編集の都度。 */
  onCellChange?: (edit: CellEdit) => void
  /** 未コミット変更の有無。 */
  onDirtyChange?: (hasChanges: boolean) => void
  /** 行追加（最下行 Enter／末尾）。 */
  onAppendRow?: (atRow: number) => void
  /** 行挿入要求。 */
  onInsertRow?: (atRow: number, pos: "above" | "below") => void
  /** 行削除要求。 */
  onDeleteRows?: (rows: number[]) => void
  /** フィルハンドルのドラッグ／ダブルクリック。 */
  onAutoFill?: (p: {
    sourceRange: Selection
    direction: "down" | "up" | "left" | "right"
    toEnd: boolean
  }) => void
  /** 選択変更。 */
  onSelectionChange?: (selection: Selection[]) => void
  /** 選択集計（合計/平均/件数）。 */
  onSelectionStats?: (stats: SelectionStats | null) => void
  /** 既定キー処理前にフック（preventDefault で抑止）。 */
  onCellKeyDown?: (e: ReactKeyboardEvent, ctx: CellContext) => void
  /** 取得/コミット失敗。 */
  onError?: (err: unknown, ctx: { phase: "fetch" | "commit" }) => void
}
