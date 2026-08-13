// boot MUST be first — installs the React Lens hook before react-dom evaluates.
import { runtime } from "./boot.js";
import "./bootTheme.js";

import { createRoot } from "react-dom/client";
import { mountEmbedded } from "@reactlens/devtools/embed";
import { App } from "./App.js";
import "./site.css";

// No StrictMode: render counts in the panel should reflect real commits only.
createRoot(document.getElementById("app")!).render(<App />);

// The site inspects itself: mount the real React Lens panel over this page.
// mountEmbedded ignores its own container, so the panel captures the site — not
// itself.
mountEmbedded(runtime);
