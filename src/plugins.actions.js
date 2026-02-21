function resolvePluginName(button) {
  return String(button.dataset.pluginName || "плагин").trim();
}

function resolvePluginId(button) {
  return String(button.dataset.pluginId || "").trim();
}

async function withBusyButton(button, busyText, callback) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const previousText = button.textContent || "";
  button.textContent = busyText;
  try {
    await callback();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = previousText;
  }
}

export function createPluginActions({
  backendClient,
  pushToast,
  reloadPlugins,
}) {
  async function handlePluginToggle(button) {
    const pluginId = resolvePluginId(button);
    const pluginName = resolvePluginName(button);
    const enabledNow = String(button.dataset.pluginEnabled || "").toLowerCase() === "true";
    if (!pluginId) return;

    await withBusyButton(button, enabledNow ? "Выключение..." : "Включение...", async () => {
      try {
        if (enabledNow) {
          await backendClient.disablePlugin(pluginId);
        } else {
          await backendClient.enablePlugin(pluginId);
        }
        pushToast(enabledNow ? `Плагин «${pluginName}» выключен.` : `Плагин «${pluginName}» включен.`, {
          tone: "success",
        });
        await reloadPlugins();
      } catch (error) {
        pushToast(`Не удалось изменить «${pluginName}»: ${error.message}`, {
          tone: "error",
          durationMs: 3600,
        });
      }
    });
  }

  async function handlePluginInstall(button) {
    const pluginId = resolvePluginId(button);
    const pluginName = resolvePluginName(button);
    const manifestUrl = String(button.dataset.pluginManifestUrl || "").trim();
    if (!pluginId) return;

    await withBusyButton(button, "Установка...", async () => {
      try {
        const payload = manifestUrl ? { id: pluginId, manifest_url: manifestUrl } : { id: pluginId };
        await backendClient.installPlugin(payload);
        pushToast(`Плагин «${pluginName}» установлен.`, { tone: "success" });
        await reloadPlugins();
      } catch (error) {
        pushToast(`Не удалось установить «${pluginName}»: ${error.message}`, {
          tone: "error",
          durationMs: 3800,
        });
      }
    });
  }

  async function handlePluginUninstall(button) {
    const pluginId = resolvePluginId(button);
    const pluginName = resolvePluginName(button);
    if (!pluginId) return;

    await withBusyButton(button, "Удаление...", async () => {
      try {
        await backendClient.uninstallPlugin(pluginId);
        pushToast(`Плагин «${pluginName}» удален.`, { tone: "success" });
        await reloadPlugins();
      } catch (error) {
        pushToast(`Не удалось удалить «${pluginName}»: ${error.message}`, {
          tone: "error",
          durationMs: 3800,
        });
      }
    });
  }

  async function handlePluginUpdate(button) {
    const pluginId = resolvePluginId(button);
    const pluginName = resolvePluginName(button);
    if (!pluginId) return;

    await withBusyButton(button, "Обновление...", async () => {
      try {
        await backendClient.updatePlugin(pluginId);
        pushToast(`Плагин «${pluginName}» обновлен.`, { tone: "success" });
        await reloadPlugins();
      } catch (error) {
        pushToast(`Не удалось обновить «${pluginName}»: ${error.message}`, {
          tone: "error",
          durationMs: 3600,
        });
      }
    });
  }

  return {
    handlePluginToggle,
    handlePluginInstall,
    handlePluginUninstall,
    handlePluginUpdate,
  };
}
