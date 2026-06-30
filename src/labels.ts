import type { VoxLabels } from "./types"

/** 内蔵 UI の既定文言（英語）。`labels` prop で部分上書きできる。 */
export const DEFAULT_LABELS: VoxLabels = {
    loading: "Loading…",
    empty: "No rows",
    contextCut: "Cut",
    contextCopy: "Copy",
    contextPaste: "Paste",
    contextInsertRowAbove: "Insert row above",
    contextInsertRowBelow: "Insert row below",
    contextDeleteRows: "Delete rows",
    contextUndo: "Undo",
    contextRedo: "Redo",
    confirmLargeCopyTitle: "Copy a large selection",
    confirmLargeCopyMessage: "The selection is large and copying may take a while. Continue?",
    confirmOk: "OK",
    confirmCancel: "Cancel",
}

export const resolveLabels = (overrides?: Partial<VoxLabels>): VoxLabels =>
    overrides ? { ...DEFAULT_LABELS, ...overrides } : DEFAULT_LABELS
