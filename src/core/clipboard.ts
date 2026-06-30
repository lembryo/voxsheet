import type { Rect } from "./range"

/** TSV の 1 セルをエスケープする（タブ/改行/引用符を含む場合はダブルクオートで囲む）。 */
const escapeCell = (text: string): string => {
    if (/[\t\n\r"]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`
    }
    return text
}

/**
 * 選択レンジ群から TSV（Excel 互換タブ区切り）テキストを生成する。
 * - 複数レンジで行範囲が一致 → 列方向に連結
 * - 列範囲が一致 → 行方向に連結
 * - それ以外 → アクティブレンジ（末尾）のみ
 */
export const buildTsv = (rects: Rect[], getValue: (row: number, col: number) => string): string => {
    if (rects.length === 0) return ""

    const rectToLines = (rect: Rect): string[] => {
        const lines: string[] = []
        for (let r = rect.r1; r <= rect.r2; r++) {
            const cells: string[] = []
            for (let c = rect.c1; c <= rect.c2; c++) cells.push(escapeCell(getValue(r, c)))
            lines.push(cells.join("\t"))
        }
        return lines
    }

    if (rects.length > 1) {
        const first = rects[0]!
        const sameRows = rects.every((rect) => rect.r1 === first.r1 && rect.r2 === first.r2)
        if (sameRows) {
            const sorted = [...rects].sort((a, b) => a.c1 - b.c1)
            const lines: string[] = []
            for (let r = first.r1; r <= first.r2; r++) {
                const cells: string[] = []
                for (const rect of sorted) {
                    for (let c = rect.c1; c <= rect.c2; c++) cells.push(escapeCell(getValue(r, c)))
                }
                lines.push(cells.join("\t"))
            }
            return lines.join("\n")
        }
        const sameCols = rects.every((rect) => rect.c1 === first.c1 && rect.c2 === first.c2)
        if (sameCols) {
            const sorted = [...rects].sort((a, b) => a.r1 - b.r1)
            return sorted.flatMap(rectToLines).join("\n")
        }
    }

    return rectToLines(rects[rects.length - 1]!).join("\n")
}

/**
 * TSV/Excel 形式のクリップボードテキストを 2 次元配列にパースする。
 * ダブルクオートで囲まれたセル内のタブ・改行・"" を正しく扱う。
 */
export const parseTsv = (text: string): string[][] => {
    const rows: string[][] = []
    let row: string[] = []
    let cell = ""
    let inQuotes = false
    let i = 0

    const pushCell = () => {
        row.push(cell)
        cell = ""
    }
    const pushRow = () => {
        pushCell()
        rows.push(row)
        row = []
    }

    while (i < text.length) {
        const ch = text[i]!
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"'
                    i += 2
                    continue
                }
                inQuotes = false
                i++
                continue
            }
            cell += ch
            i++
            continue
        }
        if (ch === '"') {
            inQuotes = true
            i++
            continue
        }
        if (ch === "\t") {
            pushCell()
            i++
            continue
        }
        if (ch === "\n" || ch === "\r") {
            // \r\n はまとめて 1 改行として扱う
            if (ch === "\r" && text[i + 1] === "\n") i++
            pushRow()
            i++
            continue
        }
        cell += ch
        i++
    }
    // 末尾セル/行の確定（末尾が空でない場合のみ行を作る）
    if (cell !== "" || row.length > 0) pushRow()
    return rows
}
