// src/test-setup.ts
// Setup global pentru toate testele Vitest.
// Importat automat conform vitest.config.ts → test.setupFiles

// Varianta /vitest: extinde expect-ul din vitest (runtime) ȘI augmentează
// tipurile `Assertion` din 'vitest' — altfel matcher-ele jest-dom
// (toBeInTheDocument etc.) pică la `tsc` în testele de componente.
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Cleanup automat DOM după fiecare test
afterEach(() => {
  cleanup()
})

// Stub-uri globale pentru API-uri browser absente în jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Stub IntersectionObserver
class IntersectionObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])
  root = null
  rootMargin = ''
  thresholds = []
}
window.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver
