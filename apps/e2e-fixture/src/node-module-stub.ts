/** Browser stub — Node's `createRequire` is unavailable in the Vite client graph. */
export function createRequire(_url?: string | URL): (id: string) => unknown {
  return () => {
    throw new Error("createRequire is unavailable in the browser");
  };
}
