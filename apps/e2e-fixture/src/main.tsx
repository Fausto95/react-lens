// boot MUST be first — installs the React Lens hook before react-dom evaluates.
import { runtime } from "./boot.js";

import { createRoot } from "react-dom/client";
import { mountEmbedded } from "@reactlens/devtools/embed";
import { App } from "./App.js";

// No StrictMode so render counts in the panel reflect real commits only.
createRoot(document.getElementById("app")!).render(<App />);

mountEmbedded(runtime);
