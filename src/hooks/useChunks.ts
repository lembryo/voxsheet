import { useCallback, useEffect, useRef, useState } from "react"
import type { CellValue, Column, FetchRowsFn, FilterSpec, SortSpec } from "../types"

const CHUNK = 200
const FETCH_DEBOUNCE_MS = 80

// ordinal が null の行は行番号（gutter）を空欄で描画する（host が明示的に null を渡した場合）。
export type VisibleRow = { values: CellValue[]; id: number; ordinal: number | null }

export type ChunkStatus = "idle" | "loading" | "error"

type Params = {
    fetchRows: FetchRowsFn
    totalRows: number
    columns: Column[]
    sort: SortSpec[]
    filters: FilterSpec[]
    search: string | undefined
    queryKey: unknown
    frozenRows: number
    startRow: number
    endRow: number
    onError?: (error: unknown, ctx: { phase: "fetch" | "commit" }) => void
}

/**
 * ビューポート範囲をチャンク単位で取得・キャッシュするフック。
 * - sort/filters/search/columns/queryKey の変化でキャッシュを無効化して再取得する。
 * - 取得は debounce し、各取得は AbortSignal で中断可能。
 */
export const useChunks = (params: Params) => {
    const {
        fetchRows,
        totalRows,
        columns,
        sort,
        filters,
        search,
        queryKey,
        frozenRows,
        startRow,
        endRow,
        onError,
    } = params

    const cacheRef = useRef<Map<number, VisibleRow[]>>(new Map())
    const pendingRef = useRef<Set<number>>(new Set())
    const controllersRef = useRef<Set<AbortController>>(new Set())
    const [rows, setRows] = useState<Map<number, VisibleRow>>(new Map())
    // レスポンス（FetchResult.total）由来の総数。null = まだレスポンス無し（この間は totalRows prop を使う）。
    // 「未確定」と「本当に 0 件」を区別するため number|null にする（0 を prop へフォールバックさせない）。
    const [respTotal, setRespTotal] = useState<number | null>(null)
    const [status, setStatus] = useState<ChunkStatus>("idle")
    // 現在の実効総数（レスポンス優先・D26。無ければ prop）。
    const total = respTotal ?? totalRows

    // 無効化キー（controlled なドメイン状態に依存）
    const invalidationKey = JSON.stringify({
        columns: columns.map((c) => c.name),
        sort,
        filters,
        search: search ?? null,
    })

    const reset = useCallback(() => {
        for (const controller of controllersRef.current) controller.abort()
        controllersRef.current.clear()
        cacheRef.current.clear()
        pendingRef.current.clear()
        setRows(new Map())
        // 新しいクエリの総数は次のレスポンスで確定させる（古い件数を引きずらない）。
        setRespTotal(null)
    }, [])

    // 無効化（controlled 状態 / queryKey の変化）
    useEffect(() => {
        reset()
    }, [invalidationKey, queryKey, reset])

    const rebuildVisible = useCallback(() => {
        const next = new Map<number, VisibleRow>()
        for (const [offset, chunk] of cacheRef.current) {
            chunk.forEach((row, i) => next.set(offset + i, row))
        }
        setRows(next)
    }, [])

    const loadChunks = useCallback(async () => {
        const effectiveTotal = respTotal ?? totalRows
        const offsets: number[] = []
        // 固定行（先頭 frozenRows 行）は常にビューポート外へ描画するため、スクロール位置に
        // 依らず先頭側のチャンクを取得しておく。frozenRows が 1 チャンクを跨ぐ場合も網羅する。
        if (frozenRows > 0) {
            const frozenTo = Math.ceil(Math.min(frozenRows, effectiveTotal) / CHUNK) * CHUNK
            for (let o = 0; o < frozenTo; o += CHUNK) offsets.push(o)
        }
        const from = Math.floor(startRow / CHUNK) * CHUNK
        const to = Math.ceil(endRow / CHUNK) * CHUNK
        for (let o = from; o < to; o += CHUNK) {
            if (o >= 0) offsets.push(o)
        }

        // 固定行側とビューポート側でチャンクが重なりうる（例: 先頭付近）。重複取得を避けるため
        // 一意化してからフィルタする。
        const targets = [...new Set(offsets)].filter(
            (o) => o < effectiveTotal && !cacheRef.current.has(o) && !pendingRef.current.has(o),
        )
        if (targets.length === 0) return

        setStatus("loading")
        const jobs = targets.map(async (offset) => {
            pendingRef.current.add(offset)
            const controller = new AbortController()
            controllersRef.current.add(controller)
            // 常に 1 チャンク分を要求する。総数が未確定（初回や stale）でも
            // チャンク満杯を取りに行き、サーバ側が末尾でクランプして返す。
            // ここで effectiveTotal でクランプすると、総数が小さく見える初回に
            // limit が極端に小さくなり（例: 1）、そのチャンクが過小取得のまま
            // キャッシュされて二度と取り直されない不具合になる。
            const limit = CHUNK
            try {
                const result = await fetchRows(
                    { offset, limit, sort, filters, search },
                    controller.signal,
                )
                const chunk: VisibleRow[] = result.data.map((values, i) => {
                    // ordinals[i] が明示的に null の行は行番号を空欄にする（例: 固定ヘッダ行）。
                    // undefined（範囲外/未指定）は従来どおり offset+i+1 にフォールバックする。
                    const ord = result.ordinals[i]
                    return {
                        values,
                        id: result.ids[i] ?? offset + i + 1,
                        ordinal: ord === undefined ? offset + i + 1 : ord,
                    }
                })
                cacheRef.current.set(offset, chunk)
                if (typeof result.total === "number") setRespTotal(result.total)
            } catch (error) {
                if (!controller.signal.aborted) {
                    onError?.(error, { phase: "fetch" })
                    setStatus("error")
                }
            } finally {
                pendingRef.current.delete(offset)
                controllersRef.current.delete(controller)
            }
        })

        await Promise.all(jobs)
        rebuildVisible()
        setStatus((prev) => (prev === "error" ? prev : "idle"))
    }, [
        fetchRows,
        sort,
        filters,
        search,
        startRow,
        endRow,
        frozenRows,
        respTotal,
        totalRows,
        onError,
        rebuildVisible,
    ])

    // 範囲変化に対する debounce 付きフェッチ
    useEffect(() => {
        const timer = setTimeout(() => {
            void loadChunks()
        }, FETCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [loadChunks])

    // total は respTotal ?? totalRows の派生値なので、totalRows prop の変化（フィルタ解除等）は
    // 自動で反映される（専用の同期 effect は不要）。

    const invalidate = useCallback(() => {
        reset()
        void loadChunks()
    }, [reset, loadChunks])

    return { rows, total, status, invalidate }
}
