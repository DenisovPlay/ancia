export async function setupTauriTitlebarDragging(titlebarElement) {
  if (!titlebarElement || !("__TAURI_INTERNALS__" in window)) {
    return;
  }

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    titlebarElement.addEventListener("mousedown", async (event) => {
      if (event.button !== 0) {
        return;
      }

      const rawTarget = event.target;
      const target =
        rawTarget instanceof Element
          ? rawTarget
          : rawTarget instanceof Node
            ? rawTarget.parentElement
            : null;

      // Keep interactive controls clickable if they are ever placed into titlebar.
      if (target?.closest("button, a, input, textarea, select, [data-no-drag], .no-drag")) {
        return;
      }

      event.preventDefault();
      try {
        await appWindow.startDragging();
      } catch (dragError) {
        // Ignore transient platform errors and keep CSS drag-region as fallback.
      }
    });
  } catch (error) {
    // Ignore: browser mode or missing Tauri bridge.
  }
}
