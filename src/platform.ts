import type { ConfirmOptions, PlatformAdapter, ToastKind } from "./types"

/**
 * 解決済みプラットフォーム。各メソッドは常に存在する（未指定は web 既定にフォールバック）。
 */
export type ResolvedPlatform = {
    readText: () => Promise<string>
    writeText: (text: string) => Promise<void>
    notify: (
        kind: ToastKind,
        message: string,
        opts?: { id?: string; durationMs?: number },
    ) => string
    confirm: (opts: ConfirmOptions) => Promise<boolean>
    saveFile: (opts: {
        suggestedName: string
        mimeType?: string
        data: string | Blob
    }) => Promise<void>
}

const hasDom = (): boolean => typeof document !== "undefined"

// --- 既定クリップボード（navigator.clipboard） ---

const defaultReadText = async (): Promise<string> => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
        return navigator.clipboard.readText()
    }
    return ""
}

const defaultWriteText = async (text: string): Promise<void> => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text)
    }
}

// --- 既定トースト（vox- スタイルの最小内蔵 DOM 実装） ---

let toastSeq = 0

const ensureToastContainer = (): HTMLElement | null => {
    if (!hasDom()) return null
    let el = document.querySelector<HTMLElement>(".vox-toast-container")
    if (!el) {
        el = document.createElement("div")
        el.className = "vox-toast-container"
        document.body.appendChild(el)
    }
    return el
}

const defaultNotify = (
    kind: ToastKind,
    message: string,
    opts?: { id?: string; durationMs?: number },
): string => {
    const container = ensureToastContainer()
    const id = opts?.id ?? `vox-toast-${++toastSeq}`
    if (!container) return id

    let toast = document.getElementById(id)
    if (!toast) {
        toast = document.createElement("div")
        toast.id = id
        container.appendChild(toast)
    }
    toast.className = `vox-toast vox-toast--${kind}`
    toast.textContent = message

    const duration = opts?.durationMs ?? (kind === "loading" ? 0 : 3000)
    if (duration > 0) {
        window.setTimeout(() => toast?.remove(), duration)
    }
    return id
}

// --- 既定確認ダイアログ（vox- スタイルの最小内蔵モーダル） ---

const defaultConfirm = (opts: ConfirmOptions): Promise<boolean> => {
    if (!hasDom()) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
        const backdrop = document.createElement("div")
        backdrop.className = "vox-modal-backdrop"

        const modal = document.createElement("div")
        modal.className = "vox-modal"
        modal.setAttribute("role", "dialog")
        modal.setAttribute("aria-modal", "true")

        const close = (result: boolean) => {
            backdrop.remove()
            resolve(result)
        }

        if (opts.title) {
            const title = document.createElement("div")
            title.className = "vox-modal-title"
            title.textContent = opts.title
            modal.appendChild(title)
        }
        const body = document.createElement("div")
        body.className = "vox-modal-body"
        body.textContent = opts.message
        modal.appendChild(body)

        const footer = document.createElement("div")
        footer.className = "vox-modal-footer"
        const cancel = document.createElement("button")
        cancel.className = "vox-btn"
        cancel.textContent = opts.cancelLabel ?? "Cancel"
        cancel.onclick = () => close(false)
        const ok = document.createElement("button")
        ok.className = "vox-btn vox-btn--primary"
        ok.textContent = opts.confirmLabel ?? "OK"
        ok.onclick = () => close(true)
        footer.append(cancel, ok)
        modal.appendChild(footer)

        backdrop.appendChild(modal)
        backdrop.onclick = (e) => {
            if (e.target === backdrop) close(false)
        }
        document.body.appendChild(backdrop)
        ok.focus()
    })
}

// --- 既定ファイル保存（ブラウザダウンロード） ---

const defaultSaveFile = async (opts: {
    suggestedName: string
    mimeType?: string
    data: string | Blob
}): Promise<void> => {
    if (!hasDom()) return
    const blob =
        typeof opts.data === "string"
            ? new Blob([opts.data], { type: opts.mimeType ?? "text/plain" })
            : opts.data
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = opts.suggestedName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

/** props の platform を web 既定とマージして解決する。 */
export const resolvePlatform = (platform?: PlatformAdapter): ResolvedPlatform => ({
    readText: platform?.clipboard?.readText ?? defaultReadText,
    writeText: platform?.clipboard?.writeText ?? defaultWriteText,
    notify: platform?.notify ?? defaultNotify,
    confirm: platform?.confirm ?? defaultConfirm,
    saveFile: platform?.saveFile ?? defaultSaveFile,
})
