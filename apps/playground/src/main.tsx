// boot MUST be first — installs the React Lens hook before react-dom evaluates.
import { runtime } from "./boot.js";

import { createRoot } from "react-dom/client";
import { mountEmbedded } from "@react-lens/devtools/embed";
import { App } from "./App.js";

// No StrictMode here so render counts in the panel reflect real commits only.
createRoot(document.getElementById("app")!).render(<App />);

// Mount the in-page React Lens panel (dev-only overlay).
mountEmbedded(runtime);
