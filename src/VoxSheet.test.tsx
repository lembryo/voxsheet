import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { VoxSheet } from "./VoxSheet"
import type { FetchResult } from "./types"

const emptyResult: FetchResult = { data: [], ids: [], ordinals: [], total: 0 }

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
})
