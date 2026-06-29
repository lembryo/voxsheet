import '@testing-library/jest-dom/vitest';

// jsdom does not implement ResizeObserver, which VoxSheet uses to track the
// viewport size. Provide a no-op stub so components can mount under test.
class ResizeObserverStub {
  observe = () => {};
  unobserve = () => {};
  disconnect = () => {};
}

globalThis.ResizeObserver = ResizeObserverStub;
