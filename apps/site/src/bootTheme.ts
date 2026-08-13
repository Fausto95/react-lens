import { applyThemePref, loadThemePref } from "./theme.js";

// Apply before React mounts so first paint matches the FOUC script.
applyThemePref(loadThemePref());
