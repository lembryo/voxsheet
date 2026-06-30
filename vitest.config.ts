import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
    // vite 7（demo）と vitest 同梱 vite 5 が同居し、設定の型解決のみ衝突するため any キャストで回避する。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: [react()] as any,
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./tests/setup.ts"],
    },
})
