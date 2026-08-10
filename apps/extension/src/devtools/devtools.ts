// Registers the React Lens panel in Chrome DevTools.
chrome.devtools.panels.create(
  "React Lens",
  "",
  "src/panel/panel.html",
  () => {
    // Panel created; the panel document wires up its own port connection.
  },
);
