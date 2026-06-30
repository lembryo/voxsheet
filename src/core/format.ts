import type { CellValue, Column, ColumnAlign, ColumnType } from '../types';

/** 型から既定の水平アラインを導出する。 */
export const defaultAlign = (type: ColumnType | undefined): ColumnAlign => {
    if (type === "number") return "right"
    if (type === "date") return "right"
    if (type === "boolean") return "center"
    return "left"
}

/** epoch ミリ秒(number)または ISO 文字列を Date に変換する（失敗時 null）。 */
const toDate = (value: CellValue): Date | null => {
    if (value === null || value === "") return null
    const d = typeof value === "number" ? new Date(value) : new Date(String(value))
    return Number.isNaN(d.getTime()) ? null : d
}

/**
 * セル値を表示文字列に整形する。column.format > 型別既定 の順で解決する。
 */
export const formatCellValue = (value: CellValue, column: Column, row: number): string => {
    const format = column.format
    if (typeof format === "function") return format(value, { column, row })
    if (value === null) return ""

    if (format && format.kind === "number" && typeof value === "number") {
        return new Intl.NumberFormat(undefined, format.options).format(value)
    }
    if (format && format.kind === "date") {
        const d = toDate(value)
        if (d) return new Intl.DateTimeFormat(undefined, format.options).format(d)
    }

    switch (column.type) {
        case "boolean":
            return value ? "✓" : ""
        case "date": {
            const d = toDate(value)
            // 既定は YYYY-MM-DD（ISO のまま表示できる場合はそれを優先）
            if (typeof value === "string") return value
            return d ? d.toISOString().slice(0, 10) : ""
        }
        case "number":
            return typeof value === "number" ? String(value) : String(value)
        default:
            return String(value)
    }
}

/**
 * 編集の生入力文字列を列の型に応じた CellValue へパースする。
 * パースできない場合は raw（文字列）を返し、検証はホスト/列 validate に委ねる。
 */
export const parseInputValue = (raw: string, type: ColumnType | undefined): CellValue => {
    if (raw === "") return type === "string" || type === undefined ? "" : null
    switch (type) {
        case "number": {
            const n = Number(raw.replace(/,/g, ""))
            return Number.isNaN(n) ? raw : n
        }
        case "boolean": {
            const lower = raw.trim().toLowerCase()
            if (["true", "1", "yes", "y", "✓"].includes(lower)) return true
            if (["false", "0", "no", "n", ""].includes(lower)) return false
            return raw
        }
        case "date":
            // 日付は ISO 文字列のまま保持する（解釈は表示側）。
            return raw
        default:
            return raw
    }
}

/** 数値として解釈できる場合に number を返す（統計用）。 */
export const numericValue = (value: CellValue): number | null => {
    if (typeof value === "number") return value
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value.replace(/,/g, ""))
        return Number.isNaN(n) ? null : n
    }
    return null
}
