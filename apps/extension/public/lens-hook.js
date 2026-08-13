/**
 * React Lens — synchronous hook stub.
 *
 * Registered by the background via chrome.scripting as a MAIN-world script at
 * document_start, so it runs as a plain classic script with NO async loader in
 * front of it (unlike @crxjs-bundled content scripts). React reads
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__` exactly once when react-dom evaluates and
 * never retries; the hook MUST already exist by then or no commit is ever
 * reported. This stub wins that race and simply buffers every commit root until
 * the heavier bridge loads (also MAIN world, same `window`), chains this hook,
 * and replays the buffer. Zero imports on purpose — bundling would reintroduce
 * the very async wrapper we're avoiding.
 */
(function () {
  var KEY = "__REACT_DEVTOOLS_GLOBAL_HOOK__";
  var existing = window[KEY];
  // Official React DevTools (or our own bridge) already here: leave it alone.
  if (existing) return;

  var renderers = new Map();
  var queue = [];
  var seq = 0;
  var MAX = 2000;

  var hook = {
    _lensStub: true,
    _lensQueue: queue,
    renderers: renderers,
    supportsFiber: true,
    checkDCE: function () {},
    inject: function (renderer) {
      var id = ++seq;
      renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot: function (_id, root) {
      try {
        queue.push(root);
        if (queue.length > MAX) queue.shift();
      } catch (_err) {
        // Never throw into React's commit path — a stub failure must not
        // take down the host app. Overflow beyond MAX is already silent.
      }
    },
    onCommitFiberUnmount: function () {},
    onPostCommitFiberRoot: function () {},
  };

  Object.defineProperty(window, KEY, {
    value: hook,
    configurable: true,
    enumerable: false,
    writable: true,
  });
})();
