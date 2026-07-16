import "@testing-library/jest-dom/vitest"

// jsdom does not implement ResizeObserver, which VoxSheet uses to track the
// viewport size. Provide a no-op stub so components can mount under test.
class ResizeObserverStub {
    observe = () => {}
    unobserve = () => {}
    disconnect = () => {}
}

globalThis.ResizeObserver = ResizeObserverStub

// jsdom does not implement canvas 2D contexts. VoxSheet measures text (row-number
// gutter auto-fit, column auto-fit) via a canvas and falls back gracefully when no
// context is available, so return null instead of emitting a "not implemented" error.
HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof HTMLCanvasElement.prototype.getContext
