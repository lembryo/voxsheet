import { useCallback, useEffect, useRef, useState } from "react"
import type { CellValue, Column, FetchRowsFn, FilterSpec, SortSpec } from "../types"

const CHUNK = 200
const FETCH_DEBOUNCE_MS = 80

export type VisibleRow = { values: CellValue[]; id: number; ordinal: number }

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
    const [total, setTotal] = useState(totalRows)
    const [status, setStatus] = useState<ChunkStatus>("idle")

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
        const effectiveTotal = total > 0 ? total : totalRows
        const offsets: number[] = []
        if (frozenRows > 0) offsets.push(0)
        const from = Math.floor(startRow / CHUNK) * CHUNK
        const to = Math.ceil(endRow / CHUNK) * CHUNK
        for (let o = from; o < to; o += CHUNK) {
            if (o >= 0) offsets.push(o)
        }

        const targets = offsets.filter(
            (o) => o < effectiveTotal && !cacheRef.current.has(o) && !pendingRef.current.has(o),
        )
        if (targets.length === 0) return

        setStatus("loading")
        const jobs = targets.map(async (offset) => {
            pendingRef.current.add(offset)
            const controller = new AbortController()
            controllersRef.current.add(controller)
            const limit = Math.min(CHUNK, effectiveTotal - offset)
            try {
                const result = await fetchRows(
                    { offset, limit, sort, filters, search },
                    controller.signal,
                )
                const chunk: VisibleRow[] = result.data.map((values, i) => ({
                    values,
                    id: result.ids[i] ?? offset + i + 1,
                    ordinal: result.ordinals[i] ?? offset + i + 1,
                }))
                cacheRef.current.set(offset, chunk)
                if (typeof result.total === "number") setTotal(result.total)
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
        total,
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

    // totalRows prop の変化を反映（フィルタ解除等）
    useEffect(() => {
        setTotal(totalRows)
    }, [totalRows])

    const invalidate = useCallback(() => {
        reset()
        void loadChunks()
    }, [reset, loadChunks])

    return { rows, total: total > 0 ? total : totalRows, status, invalidate }
}
