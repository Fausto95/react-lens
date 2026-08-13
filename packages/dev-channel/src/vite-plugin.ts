import type { Plugin } from "vite";

/** Vite plugin stub — wires dev-channel URL into the app config (A4 MVP). */
export function reactLensDevChannel(opts: { port?: number } = {}): Plugin {
  const port = opts.port ?? 9234;
  return {
    name: "react-lens-dev-channel",
    config() {
      return {
        define: {
          __REACT_LENS_DEV_CHANNEL_PORT__: JSON.stringify(port),
        },
      };
    },
  };
}
