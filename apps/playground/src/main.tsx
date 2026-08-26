// boot MUST be first — installs the React Lens hook before react-dom evaluates.
import { runtime } from "./boot.js";

import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import { mountEmbedded } from "@reactlens/devtools/embed";
import { App } from "./App.js";
import { CinemaChakraProvider } from "./theme.js";
import { queryClient } from "./state/query.js";
import { localeStore } from "./state/locale.js";
import "./styles.css";

if (import.meta.env.DEV) {
  void import("virtual:stylex:runtime");
}

// No StrictMode here so render counts in the panel reflect real commits only.
createRoot(document.getElementById("app")!).render(
  <CinemaChakraProvider>
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={localeStore}>
        <App />
      </JotaiProvider>
    </QueryClientProvider>
  </CinemaChakraProvider>,
);

mountEmbedded(runtime);
