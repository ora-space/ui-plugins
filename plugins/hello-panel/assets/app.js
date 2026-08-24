// deno-lint-ignore-file no-window -- browser page: `window` is the page global Ora injects into.
// The page is a view over state owned by the plugin process: every click becomes
// one `window.ora.invoke("counter/…")` and every answer is the full state.
// Nothing is imported: `window.ora` is injected by Ora before this runs.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const countEl = $("count");
  const statusEl = $("status");
  const buttons = Array.from(document.querySelectorAll("button[data-action]"));

  function render(state) {
    countEl.textContent = String(state.count);
  }

  function showStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle("status--error", Boolean(isError));
  }

  function describeError(error) {
    if (error && error.kind === "plugin") {
      return `插件错误 ${error.code}: ${error.message}`;
    }
    if (error && error.kind === "host") {
      return `宿主错误 ${error.code}`;
    }
    return `未知错误: ${String(error)}`;
  }

  if (
    window.ora === undefined || typeof window.ora.invoke !== "function"
  ) {
    showStatus("这个页面需要在 Ora 中作为插件面板打开。", true);
    buttons.forEach((button) => (button.disabled = true));
    return;
  }

  async function send(action) {
    const started = performance.now();
    buttons.forEach((button) => (button.disabled = true));
    try {
      const state = await window.ora.invoke(`counter/${action}`);
      render(state);
      const elapsed = Math.round(performance.now() - started);
      showStatus(`${action} → 进程 → 页面：${elapsed} ms`);
    } catch (error) {
      showStatus(describeError(error), true);
    } finally {
      buttons.forEach((button) => (button.disabled = false));
    }
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => send(button.dataset.action));
  });

  // A fresh page (first open or reload) always re-reads the state from the process.
  send("get");
})();
