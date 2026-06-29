import { useCallback, useMemo, useRef, useState } from "react"
import type { CellEdit, CellValue } from "../types"

const MAX_UNDO = 200

const keyOf = (row: number, col: number): string => `${row}:${col}`

type Params = {
    onCellChange?: (edit: CellEdit) => void
    onDirtyChange?: (hasChanges: boolean) => void
}

/**
 * ローカル編集レイヤー。未コミットの編集を保持し、Undo/Redo と dirty 追跡を行う。
 * 永続化はしない（ホストが getLocalEdits を取り出してコミットする）。
 */
export const useEditBuffer = ({ onCellChange, onDirtyChange }: Params) => {
    const editsRef = useRef<Map<string, CellValue>>(new Map())
    const originalRef = useRef<Map<string, CellValue>>(new Map())
    const undoRef = useRef<CellEdit[][]>([])
    const redoRef = useRef<CellEdit[][]>([])
    // 編集の変化で再描画させるためのバージョン
    const [version, setVersion] = useState(0)

    const notifyDirty = useCallback(() => {
        onDirtyChange?.(editsRef.current.size > 0)
    }, [onDirtyChange])

    // 1 セルへ値を適用する（元値に戻れば dirty 解除）。
    const applyValue = useCallback(
        (
            row: number,
            col: number,
            value: CellValue,
            getBase: (r: number, c: number) => CellValue,
        ) => {
            const key = keyOf(row, col)
            if (!originalRef.current.has(key)) {
                originalRef.current.set(key, getBase(row, col))
            }
            const original = originalRef.current.get(key) ?? null
            if (value === original) {
                editsRef.current.delete(key)
                originalRef.current.delete(key)
            } else {
                editsRef.current.set(key, value)
            }
            onCellChange?.({ row, col, oldValue: original, newValue: value })
        },
        [onCellChange],
    )

    /** 1 操作（複数セル）を適用し、Undo スタックに 1 アクションとして積む。 */
    const applyEdits = useCallback(
        (edits: CellEdit[], getBase: (r: number, c: number) => CellValue) => {
            if (edits.length === 0) return
            for (const edit of edits) applyValue(edit.row, edit.col, edit.newValue, getBase)
            undoRef.current.push(edits)
            if (undoRef.current.length > MAX_UNDO) undoRef.current.shift()
            redoRef.current = []
            setVersion((v) => v + 1)
            notifyDirty()
        },
        [applyValue, notifyDirty],
    )

    const noBase = useCallback((): CellValue => null, [])

    const undo = useCallback(() => {
        const action = undoRef.current.pop()
        if (!action) return
        for (let i = action.length - 1; i >= 0; i--) {
            const edit = action[i]!
            applyValue(edit.row, edit.col, edit.oldValue, noBase)
        }
        redoRef.current.push(action)
        setVersion((v) => v + 1)
        notifyDirty()
    }, [applyValue, noBase, notifyDirty])

    const redo = useCallback(() => {
        const action = redoRef.current.pop()
        if (!action) return
        for (const edit of action) applyValue(edit.row, edit.col, edit.newValue, noBase)
        undoRef.current.push(action)
        setVersion((v) => v + 1)
        notifyDirty()
    }, [applyValue, noBase, notifyDirty])

    const getEditedValue = useCallback((row: number, col: number): CellValue | undefined => {
        const key = keyOf(row, col)
        return editsRef.current.has(key) ? editsRef.current.get(key) : undefined
    }, [])

    const isDirty = useCallback(
        (row: number, col: number): boolean => editsRef.current.has(keyOf(row, col)),
        [],
    )

    const getLocalEdits = useCallback((): CellEdit[] => {
        const result: CellEdit[] = []
        for (const [key, newValue] of editsRef.current) {
            const [rs, cs] = key.split(":")
            result.push({
                row: Number(rs),
                col: Number(cs),
                oldValue: originalRef.current.get(key) ?? null,
                newValue,
            })
        }
        return result
    }, [])

    const clear = useCallback(() => {
        editsRef.current.clear()
        originalRef.current.clear()
        undoRef.current = []
        redoRef.current = []
        setVersion((v) => v + 1)
        onDirtyChange?.(false)
    }, [onDirtyChange])

    const canUndo = useCallback(() => undoRef.current.length > 0, [])
    const canRedo = useCallback(() => redoRef.current.length > 0, [])

    // 返り値の identity を安定させる。毎レンダーで新オブジェクトを返すと、これに依存する
    // getRawValue や選択統計の effect が毎レンダー再実行され、無限ループ
    //（Maximum update depth exceeded）の原因になる。
    return useMemo(
        () => ({
            version,
            applyEdits,
            undo,
            redo,
            getEditedValue,
            isDirty,
            getLocalEdits,
            clear,
            canUndo,
            canRedo,
        }),
        [version, applyEdits, undo, redo, getEditedValue, isDirty, getLocalEdits, clear, canUndo, canRedo],
    )
}
