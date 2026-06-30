import type { Selection } from "../types"

/** 正規化済みの矩形（r1<=r2, c1<=c2）。 */
export type Rect = { r1: number; r2: number; c1: number; c2: number }

export const normalizeRect = (sel: Selection): Rect => ({
    r1: Math.min(sel.start.row, sel.end.row),
    r2: Math.max(sel.start.row, sel.end.row),
    c1: Math.min(sel.start.col, sel.end.col),
    c2: Math.max(sel.start.col, sel.end.col),
})

export const normalizeRects = (selections: Selection[]): Rect[] => selections.map(normalizeRect)

export const rectContains = (rect: Rect, row: number, col: number): boolean =>
    row >= rect.r1 && row <= rect.r2 && col >= rect.c1 && col <= rect.c2

export const cellInRects = (rects: Rect[], row: number, col: number): boolean =>
    rects.some((rect) => rectContains(rect, row, col))

/** 矩形が「行全体（全列を含む）」かどうか。 */
export const isFullRowRect = (rect: Rect, columnCount: number): boolean =>
    rect.c1 === 0 && rect.c2 === columnCount - 1

/** 矩形が「列全体（全行を含む）」かどうか。 */
export const isFullColRect = (rect: Rect, totalRows: number): boolean =>
    rect.r1 === 0 && rect.r2 === totalRows - 1

/** レンジ群に含まれる行の和集合（昇順）。 */
export const rowsInRects = (rects: Rect[]): number[] => {
    const set = new Set<number>()
    for (const rect of rects) {
        for (let r = rect.r1; r <= rect.r2; r++) set.add(r)
    }
    return Array.from(set).sort((a, b) => a - b)
}

/** レンジ群の総セル数（未取得行も含む論理的なセル数）。 */
export const totalCellCount = (rects: Rect[]): number =>
    rects.reduce((sum, rect) => sum + (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1), 0)
