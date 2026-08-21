// deno-lint-ignore-file no-window -- browser page: `window` is the page global Ora injects into.
// The page is a view over state owned by the plugin process: every click becomes one
// `request`, every answer is the full state, and stopwatch ticks arrive as pushes.
// Nothing is imported: `acquireOraSurfaceApi` is injected by Ora before this runs.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const countEl = $("count");
  const secondsEl = $("seconds");
  const tickingEl = $("ticking");
  const statusEl = $("status");
  const buttons = Array.from(document.querySelectorAll("button[data-action]"));

  function render(state) {
    countEl.textContent = String(state.count);
    secondsEl.textContent = `${state.seconds} s`;
    tickingEl.textContent = state.ticking ? "进程推送中" : "已停止";
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

  if (typeof window.acquireOraSurfaceApi !== "function") {
    showStatus("这个页面需要在 Ora 中作为插件面板打开。", true);
    buttons.forEach((button) => (button.disabled = true));
    return;
  }

  const api = window.acquireOraSurfaceApi();

  // Pushes carry only what changed on the process side; the page keeps the last
  // full state and patches the pushed field so the counter never flickers.
  let last = { count: 0, ticking: false, seconds: 0 };
  api.onPush((envelope) => {
    const payload = envelope.payload;
    if (payload && payload.type === "tick") {
      last = { ...last, ticking: true, seconds: payload.seconds };
      render(last);
      showStatus(`push #${envelope.sequence}: tick ${payload.seconds}`);
    }
  });

  async function send(type) {
    const started = performance.now();
    buttons.forEach((button) => (button.disabled = true));
    try {
      last = await api.request({ type });
      render(last);
      const elapsed = Math.round(performance.now() - started);
      showStatus(`${type} → 进程 → 页面：${elapsed} ms`);
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
