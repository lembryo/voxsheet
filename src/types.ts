/**
 * チャンク取得の戻り値。
 * data[i] が i 行目のセル値、ids[i] が行 ID、ordinals[i] が表示順序。
 */
export type FetchResult = {
  data: string[][];
  ids: number[];
  ordinals: number[];
};

/**
 * 行データを範囲指定で取得する関数。
 * バックエンドへの fetch / IndexedDB / SQLite クエリなどを背後に隠蔽する。
 */
export type FetchRowsFn = (offset: number, limit: number) => Promise<FetchResult>;

export type VoxSheetProps = {
  /** カラム表示名 */
  columns: string[];
  /** フィルタ後の総件数 */
  totalRows: number;
  /** チャンク取得関数 */
  fetchRows: FetchRowsFn;
  /** 行の高さ (px)。デフォルト 28 */
  rowHeight?: number;
  /** 列のデフォルト幅 (px)。デフォルト 120 */
  defaultColumnWidth?: number;
  /** 読み取り専用モード (編集 UI を表示しない) */
  readOnly?: boolean;
};
