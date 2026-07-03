import { describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { VoxSheet } from "./VoxSheet"
import type { FetchResult, FetchRowsFn, SortSpec } from "./types"

const emptyResult: FetchResult = { data: [], ids: [], ordinals: [], total: 0 }

/** offset..offset+limit の行を `r{n}` という 1 セル値で返す決定論的な fetchRows。 */
const makeFetchRows =
    (total: number): FetchRowsFn =>
    async ({ offset, limit }) => {
        const count = Math.max(0, Math.min(limit, total - offset))
        const data: string[][] = []
        const ids: number[] = []
        const ordinals: number[] = []
        for (let i = 0; i < count; i++) {
            data.push([`r${offset + i}`])
            ids.push(offset + i + 1)
            ordinals.push(offset + i + 1)
        }
        return { data, ids, ordinals, total }
    }

describe("VoxSheet", () => {
    it("renders column headers", () => {
        const fetchRows = vi.fn().mockResolvedValue(emptyResult)

        render(
            <VoxSheet
                columns={[{ name: "A" }, { name: "B" }, { name: "C" }]}
                totalRows={0}
                fetchRows={fetchRows}
            />,
        )

        expect(screen.getByRole("columnheader", { name: "A" })).toBeInTheDocument()
        expect(screen.getByRole("columnheader", { name: "B" })).toBeInTheDocument()
        expect(screen.getByRole("columnheader", { name: "C" })).toBeInTheDocument()
    })

    it("has correct aria-rowcount", () => {
        const fetchRows = vi
            .fn()
            .mockResolvedValue({ ...emptyResult, total: 1_000_000 } satisfies FetchResult)

        render(<VoxSheet columns={[{ name: "A" }]} totalRows={1_000_000} fetchRows={fetchRows} />)

        expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "1000000")
    })

    it("renders the first rows in a frozen band when frozenRows is set", async () => {
        const { container } = render(
            <VoxSheet
                columns={[{ name: "A" }]}
                totalRows={1000}
                fetchRows={makeFetchRows(1000)}
                frozenRows={2}
            />,
        )

        // 固定バンドが描画され、先頭 2 行がその中に入る。
        const band = await waitFor(() => {
            const el = container.querySelector(".vox-frozen-band")
            if (!el) throw new Error("frozen band not rendered")
            return el as HTMLElement
        })
        await waitFor(() => {
            expect(band.textContent).toContain("r0")
            expect(band.textContent).toContain("r1")
        })
        // 固定行（r0/r1）は本体スクロール領域には重複して現れない。
        const body = container.querySelector(".vox-body") as HTMLElement
        expect(body.textContent).not.toContain("r0")
    })

    it("does not render a frozen band when frozenRows is 0", async () => {
        const { container } = render(
            <VoxSheet columns={[{ name: "A" }]} totalRows={1000} fetchRows={makeFetchRows(1000)} />,
        )
        await waitFor(() => {
            expect(container.querySelector(".vox-body")?.textContent).toContain("r0")
        })
        expect(container.querySelector(".vox-frozen-band")).toBeNull()
    })

    const modeColumn = {
        name: "A",
        sortModes: [
            { id: "text", label: "Text" },
            { id: "num", label: "Number" },
        ],
        defaultSortMode: "text",
    }

    it("attaches the default sort mode when sorting a column with sortModes", () => {
        const onSortChange = vi.fn()
        render(
            <VoxSheet
                columns={[modeColumn]}
                totalRows={0}
                fetchRows={vi.fn().mockResolvedValue(emptyResult)}
                sort={[]}
                onSortChange={onSortChange}
            />,
        )
        fireEvent.click(screen.getByRole("button", { name: "Sort A" }))
        expect(onSortChange).toHaveBeenCalledWith([{ column: "A", direction: "asc", mode: "text" }])
    })

    it("lets the mode picker choose a different sort mode", () => {
        const onSortChange = vi.fn()
        render(
            <VoxSheet
                columns={[modeColumn]}
                totalRows={0}
                fetchRows={vi.fn().mockResolvedValue(emptyResult)}
                sort={[]}
                onSortChange={onSortChange}
            />,
        )
        fireEvent.click(screen.getByRole("button", { name: "Sort options: A" }))
        fireEvent.click(screen.getByRole("menuitem", { name: /Number/ }))
        expect(onSortChange).toHaveBeenCalledWith([{ column: "A", direction: "asc", mode: "num" }])
    })

    it("keeps showing data after sorting (controlled sort round-trip)", async () => {
        const Harness = () => {
            const [sort, setSort] = useState<SortSpec[]>([])
            return (
                <VoxSheet
                    columns={[{ name: "A" }, { name: "B" }]}
                    totalRows={1000}
                    fetchRows={makeFetchRows(1000)}
                    sort={sort}
                    onSortChange={setSort}
                />
            )
        }
        const { container } = render(<Harness />)
        await waitFor(() =>
            expect(container.querySelector(".vox-body")?.textContent).toContain("r0"),
        )
        // ヘッダの Sort ボタンで並べ替え → controlled sort 更新 → 再取得後もデータが出る
        fireEvent.click(screen.getByRole("button", { name: "Sort A" }))
        await waitFor(() =>
            expect(container.querySelector(".vox-body")?.textContent).toContain("r0"),
        )
    })

    it("keeps showing data after sorting with a slow, abort-respecting fetch", async () => {
        // 本物のデモに近い fetchRows: 遅延あり＋AbortSignal で reject する。
        const slowFetch: FetchRowsFn = (query, signal) =>
            new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    const count = Math.min(query.limit, 1000 - query.offset)
                    resolve({
                        data: Array.from({ length: count }, (_, i) => [`r${query.offset + i}`]),
                        ids: Array.from({ length: count }, (_, i) => query.offset + i + 1),
                        ordinals: Array.from({ length: count }, (_, i) => query.offset + i + 1),
                        total: 1000,
                    })
                }, 30)
                signal.addEventListener("abort", () => {
                    clearTimeout(timer)
                    reject(new DOMException("Aborted", "AbortError"))
                })
            })
        const Harness = () => {
            const [sort, setSort] = useState<SortSpec[]>([])
            return (
                <VoxSheet
                    columns={[
                        {
                            name: "A",
                            sortModes: [
                                { id: "text", label: "Text" },
                                { id: "numeric", label: "Numeric" },
                            ],
                            defaultSortMode: "text",
                        },
                        { name: "B" },
                    ]}
                    totalRows={1000}
                    fetchRows={slowFetch}
                    sort={sort}
                    onSortChange={setSort}
                />
            )
        }
        const { container } = render(<Harness />)
        await waitFor(() =>
            expect(container.querySelector(".vox-body")?.textContent).toContain("r0"),
        )
        fireEvent.click(screen.getByRole("button", { name: "Sort A" }))
        await waitFor(
            () => expect(container.querySelector(".vox-body")?.textContent).toContain("r0"),
            { timeout: 2000 },
        )
    })

    it("shows a loading indicator while a sort refetch is in flight (not blank)", async () => {
        let calls = 0
        const fetchRows: FetchRowsFn = async () => {
            calls += 1
            if (calls === 1) return { data: [["v0"]], ids: [1], ordinals: [1], total: 1000 }
            return new Promise<FetchResult>(() => {}) // 2回目以降は解決しない＝取得中を再現
        }
        const Harness = () => {
            const [sort, setSort] = useState<SortSpec[]>([])
            return (
                <VoxSheet
                    columns={[{ name: "A" }]}
                    totalRows={1000}
                    fetchRows={fetchRows}
                    sort={sort}
                    onSortChange={setSort}
                    labels={{ loading: "LOADING_NOW" }}
                />
            )
        }
        const { container } = render(<Harness />)
        await waitFor(() =>
            expect(container.querySelector(".vox-body")?.textContent).toContain("v0"),
        )
        // ソート → 再取得が始まり行が破棄される。空白ではなくローディングが出る。
        fireEvent.click(screen.getByRole("button", { name: "Sort A" }))
        await waitFor(() => expect(screen.getByText("LOADING_NOW")).toBeInTheDocument())
    })

    it("keeps a frozen row populated after sorting", async () => {
        // sort の有無で値のプレフィックスを変える（u=未ソート, s=ソート済み）。
        const fetchRows: FetchRowsFn = async ({ offset, limit, sort }) => {
            const p = sort.length > 0 ? "s" : "u"
            const count = Math.min(limit, 1000 - offset)
            return {
                data: Array.from({ length: count }, (_, i) => [`${p}${offset + i}`]),
                ids: Array.from({ length: count }, (_, i) => offset + i + 1),
                ordinals: Array.from({ length: count }, (_, i) => offset + i + 1),
                total: 1000,
            }
        }
        const Harness = () => {
            const [sort, setSort] = useState<SortSpec[]>([])
            return (
                <VoxSheet
                    columns={[{ name: "A" }]}
                    totalRows={1000}
                    fetchRows={fetchRows}
                    frozenRows={1}
                    sort={sort}
                    onSortChange={setSort}
                />
            )
        }
        const { container } = render(<Harness />)
        const band = await waitFor(() => {
            const el = container.querySelector(".vox-frozen-band")
            if (!el || !el.textContent?.includes("u0")) throw new Error("frozen row not ready")
            return el as HTMLElement
        })
        // 並べ替え → 固定バンドの先頭行がソート済みデータ（s0）に更新される
        fireEvent.click(screen.getByRole("button", { name: "Sort A" }))
        await waitFor(() => expect(band.textContent).toContain("s0"))
        // 固定行は本体スクロール領域に重複しない（本体は s1 から）。
        const body = container.querySelector(".vox-body") as HTMLElement
        expect(body.textContent).toContain("s1")
        expect(body.textContent).not.toContain("s0")
    })

    it("renders frozen columns as sticky-positioned cells", async () => {
        const { container } = render(
            <VoxSheet
                columns={[{ name: "A" }, { name: "B" }, { name: "C" }]}
                totalRows={1000}
                fetchRows={makeFetchRows(1000)}
                frozenColumns={1}
            />,
        )
        await waitFor(() =>
            expect(container.querySelector(".vox-body")?.textContent).toContain("r0"),
        )
        const frozen = container.querySelectorAll(".vox-cell--frozen-col")
        expect(frozen.length).toBeGreaterThan(0)
        expect((frozen[0] as HTMLElement).style.position).toBe("sticky")
    })

    it("reorders columns via header drag and drop", () => {
        const onColumnReorder = vi.fn()
        render(
            <VoxSheet
                columns={[{ name: "A" }, { name: "B" }]}
                totalRows={0}
                fetchRows={vi.fn().mockResolvedValue(emptyResult)}
                onColumnReorder={onColumnReorder}
            />,
        )
        const labelA = screen.getByText("A")
        const headerB = screen.getByRole("columnheader", { name: "B" })
        const dataTransfer = {
            setData: vi.fn(),
            getData: vi.fn(),
            effectAllowed: "",
            dropEffect: "",
        }
        fireEvent.dragStart(labelA, { dataTransfer })
        fireEvent.dragOver(headerB, { dataTransfer })
        fireEvent.drop(headerB, { dataTransfer })
        expect(onColumnReorder).toHaveBeenCalledWith(0, 1)
    })

    it("shows a count badge when a column has multiple filters", () => {
        render(
            <VoxSheet
                columns={[{ name: "A" }]}
                totalRows={0}
                fetchRows={vi.fn().mockResolvedValue(emptyResult)}
                filters={[
                    { column: "A", operator: "=", value: 1 },
                    { column: "A", operator: "!=", value: 2 },
                ]}
                onFilterButtonClick={() => undefined}
            />,
        )
        expect(screen.getByRole("button", { name: "Filter A" }).textContent).toContain("2")
    })

    it("clears the dirty mark when a cell is reverted to its original value", async () => {
        const { container } = render(
            <VoxSheet columns={[{ name: "A" }]} totalRows={1000} fetchRows={makeFetchRows(1000)} />,
        )
        await waitFor(() =>
            expect(container.querySelector(".vox-body")?.textContent).toContain("r0"),
        )
        const cell = screen.getAllByRole("gridcell")[0] as HTMLElement
        const edit = (value: string) => {
            fireEvent.doubleClick(cell)
            const input = container.querySelector(".vox-cell-input") as HTMLInputElement
            fireEvent.change(input, { target: { value } })
            fireEvent.blur(input)
        }
        edit("changed")
        await waitFor(() => expect(container.querySelector(".vox-cell--dirty")).not.toBeNull())
        edit("r0") // 元値へ戻す
        await waitFor(() => expect(container.querySelector(".vox-cell--dirty")).toBeNull())
    })

    it("shows the empty state when a query returns total 0 (not blank rows)", async () => {
        // 静的な totalRows を渡しつつ、レスポンスが total:0 を返すケース（フィルタで 0 件）。
        const fetchRows: FetchRowsFn = async () => ({
            data: [],
            ids: [],
            ordinals: [],
            total: 0,
        })
        render(
            <VoxSheet
                columns={[{ name: "A" }]}
                totalRows={1000}
                fetchRows={fetchRows}
                renderEmpty={() => <div>NO_RESULTS</div>}
            />,
        )
        // total は 1000 ではなく 0 に確定し、空状態が出る（空白行を描画しない）。
        await waitFor(() => expect(screen.getByText("NO_RESULTS")).toBeInTheDocument())
        expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "0")
    })

    it("does not attach a mode or show a picker for plain columns", () => {
        const onSortChange = vi.fn()
        render(
            <VoxSheet
                columns={[{ name: "A" }]}
                totalRows={0}
                fetchRows={vi.fn().mockResolvedValue(emptyResult)}
                sort={[]}
                onSortChange={onSortChange}
            />,
        )
        expect(screen.queryByRole("button", { name: "Sort options: A" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Sort A" }))
        expect(onSortChange).toHaveBeenCalledWith([{ column: "A", direction: "asc" }])
    })
})
