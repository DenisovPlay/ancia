export function clearBrowserStorage() {
  try {
    window.localStorage.clear();
  } catch (error) {
    // noop
  }
  try {
    window.sessionStorage.clear();
  } catch (error) {
    // noop
  }

  const cookies = document.cookie ? document.cookie.split(";") : [];
  cookies.forEach((entry) => {
    const cookieName = String(entry.split("=")[0] || "").trim();
    if (!cookieName) {
      return;
    }
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${location.hostname}`;
  });

  if (window.indexedDB && typeof window.indexedDB.databases === "function") {
    void window.indexedDB.databases().then((dbList) => {
      (dbList || []).forEach((dbInfo) => {
        const dbName = String(dbInfo?.name || "").trim();
        if (dbName) {
          window.indexedDB.deleteDatabase(dbName);
        }
      });
    }).catch(() => {
      // noop
    });
  }
}

export async function handleResetAllAction({
  requestActionConfirm,
  runtimeConfig,
  backendClient,
  pushToast,
}) {
  const confirmed = await requestActionConfirm(
    "Сбросить все данные приложения? Будут удалены чаты, настройки, локальные данные браузера и состояние плагинов.",
    {
      title: "Сброс приложения",
      confirmLabel: "Сбросить всё",
      cancelLabel: "Отмена",
      danger: true,
    },
  );
  if (!confirmed) {
    return false;
  }

  let backendResetOk = false;
  if (runtimeConfig.mode === "backend" && runtimeConfig.backendUrl) {
    try {
      await backendClient.resetApp({ reset_onboarding: true });
      backendResetOk = true;
    } catch (error) {
      pushToast(`Сброс в бэкенде не выполнен: ${error.message}`, {
        tone: "error",
        durationMs: 4200,
      });
    }
  }

  clearBrowserStorage();
  pushToast(
    backendResetOk
      ? "Данные приложения сброшены. Перезапускаем интерфейс..."
      : "Локальные данные очищены. Перезапускаем интерфейс...",
    { tone: backendResetOk ? "success" : "warning", durationMs: 2200 },
  );
  window.setTimeout(() => {
    window.location.reload();
  }, 220);
  return true;
}
