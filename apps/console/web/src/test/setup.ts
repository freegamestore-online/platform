// Test environment setup.
//
// Node 22+ ships an experimental global `localStorage` that is unavailable
// unless the process is started with `--localstorage-file`, and it shadows the
// one jsdom would otherwise provide — so `localStorage.clear()` etc. throw in
// tests (it silently broke ai-keys.test.ts). Install a small in-memory Storage
// so both the tests and the code under test have a working localStorage.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function install(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

// Replace it if the ambient one is missing or throws on use.
try {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (!ls) {
    install();
  } else {
    ls.setItem('__probe__', '1');
    ls.removeItem('__probe__');
  }
} catch {
  install();
}

// jsdom doesn't implement scrollIntoView; the studio's auto-scroll effect calls
// it on a timer, which would otherwise throw as an unhandled exception in
// component tests. Provide a no-op.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

import '@testing-library/jest-dom';
