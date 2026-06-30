import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { resolve } from "node:path"

export default defineConfig({
    // ワークスペースに vite 7（demo）と vitest 同梱の vite 5 が同居しており、ビルド設定の
    // 型解決だけが両者で衝突する（実行時は各々が自前の vite を使うため問題なし）。
    // 出荷物でも lint 対象でもないビルド設定に限定して any キャストで衝突を回避する。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: [react()] as any,
    build: {
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            name: "VoxSheet",
            fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
            formats: ["es", "cjs"],
        },
        rollupOptions: {
            external: ["react", "react-dom", "react/jsx-runtime"],
            output: {
                globals: {
                    react: "React",
                    "react-dom": "ReactDOM",
                    "react/jsx-runtime": "jsxRuntime",
                },
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css") return "voxsheet.css"
                    return assetInfo.name ?? "[name][extname]"
                },
            },
        },
        sourcemap: true,
        emptyOutDir: true,
    },
})
