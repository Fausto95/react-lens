import type { Page } from "@playwright/test";

export interface LensPlaywright {
  /** Run fn inside a named React Lens interaction window. */
  interaction<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

declare global {
  interface Window {
    __REACT_LENS__?: {
      markInteraction?: (name: string, untilMs?: number) => void;
    };
  }
}

export function lens(page: Page): LensPlaywright {
  return {
    async interaction<T>(name: string, fn: () => Promise<T>): Promise<T> {
      await page.evaluate((n) => {
        window.__REACT_LENS__?.markInteraction?.(n);
      }, name);
      try {
        return await fn();
      } finally {
        /* interaction window closes via instrumentation timeout */
      }
    },
  };
}
