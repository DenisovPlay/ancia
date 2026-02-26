import { icon } from "../ui/icons.js";

const inputCls = "rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-600";
const rowCls  = "flex items-center justify-between gap-4 py-3";
const labelCls = "text-xs text-zinc-500 shrink-0";

export const settingsPageTemplate = `
  <aside
    id="settings-aside"
    class="page-aside bg-zinc-950/60 backdrop-blur-sm fixed inset-y-0 left-0 z-10 flex w-[84vw] max-w-[260px] -translate-x-[112%] flex-col p-3 pt-10 opacity-0 pointer-events-none transition-transform duration-200 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:w-full xl:max-w-full xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto xl:pt-3"
  >
    <input
      id="settings-section-search"
      type="search"
      aria-label="Поиск раздела"
      placeholder="Поиск раздела"
      class="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-100 outline-none transition focus:border-zinc-600"
    />
    <p id="settings-section-search-empty" class="mt-3 hidden text-xs text-zinc-500">Разделы не найдены</p>

    <nav class="mt-3 space-y-1.5" aria-label="Пункты настроек">
      <button type="button" data-settings-section-target="personalization" data-active="true"
        class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("personalization", "ui-icon-lg")}<span>Персонализация</span></span>
      </button>
      <button type="button" data-settings-section-target="interface" data-active="false"
        class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("interface", "ui-icon-lg")}<span>Интерфейс</span></span>
      </button>
      <button type="button" data-settings-section-target="developer" data-active="false"
        class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("developers", "ui-icon-lg")}<span>Расширенные</span></span>
      </button>
      <button type="button" data-settings-section-target="server" data-active="false"
        class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("shield-check", "ui-icon-lg")}<span>Сервер</span></span>
      </button>
      <button type="button" data-settings-section-target="about" data-active="false"
        class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("info", "ui-icon-lg")}<span>О приложении</span></span>
      </button>
    </nav>
  </aside>

  <main class="page-main bg-zinc-950/60 backdrop-blur-sm relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-3">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 pt-3">
      <div>
        <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Настройки</p>
        <h1 id="settings-section-title" class="text-base font-semibold text-zinc-200 sm:text-lg">Персонализация</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span id="settings-dirty-badge" class="hidden rounded-md border border-amber-900/40 bg-amber-950/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-400">
          Есть изменения
        </span>
        <button type="button" data-open-settings-aside aria-label="Разделы" aria-controls="settings-aside" aria-expanded="false" title="Разделы"
          class="icon-button active:scale-95 duration-300 h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 xl:hidden">
          ${icon("categories")}
        </button>
        <button id="settings-save-config" type="button" aria-keyshortcuts="Control+S Meta+S"
          class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-600 bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200">
          ${icon("save")}
          <span>Сохранить</span>
        </button>
      </div>
    </div>

    <section class="chat-scroll min-h-0 flex-1 overflow-auto pb-3">

      <article data-settings-section="personalization" class="settings-section rounded-xl border border-zinc-800/60 divide-y divide-zinc-800/60">
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Имя</span>
          <input id="settings-user-name" type="text" placeholder="Андрей" class="${inputCls} w-48 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Язык</span>
          <select id="settings-user-language" class="${inputCls} w-28 text-right">
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Часовой пояс</span>
          <input id="settings-user-timezone" type="text" placeholder="Europe/Moscow" class="${inputCls} w-48 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Контекст</span>
          <input id="settings-user-context" type="text" placeholder="Основатель, инженер..." class="${inputCls} flex-1 min-w-0 text-right" />
        </div>
      </article>

      <article data-settings-section="interface" class="settings-section hidden rounded-xl border border-zinc-800/60 divide-y divide-zinc-800/60">
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Плотность</span>
          <select id="settings-ui-density" class="${inputCls} w-40 text-right">
            <option value="comfortable">Комфортная</option>
            <option value="compact">Компактная</option>
          </select>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Масштаб шрифта</span>
          <input id="settings-ui-font-scale" type="number" min="85" max="120" step="1" class="${inputCls} w-20 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Семейство шрифтов</span>
          <select id="settings-ui-font-preset" class="${inputCls} w-40 text-right">
            <option value="system">Sans</option>
            <option value="serif">Serif</option>
            <option value="rounded">Rounded</option>
            <option value="mono">Mono</option>
            <option value="custom">Свой</option>
          </select>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Системный шрифт</span>
          <div class="flex items-center gap-2">
            <select id="settings-ui-font-family" class="${inputCls} w-40 text-right">
              <option value="">Сканируем...</option>
            </select>
            <button id="settings-ui-font-refresh" type="button"
              class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-zinc-400 transition hover:bg-zinc-800">
              ${icon("refresh")}
            </button>
          </div>
        </div>
        <p id="settings-ui-font-meta" class="px-3.5 py-2.5 text-xs text-zinc-600">Системные шрифты, без внешних CDN</p>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-ui-animations" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Анимации</span>
          </label>
        </div>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-ui-show-inspector" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Показывать инспектор</span>
          </label>
        </div>
      </article>

      <article data-settings-section="developer" class="settings-section hidden rounded-xl border border-zinc-800/60 divide-y divide-zinc-800/60">
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Переход (мс)</span>
          <input id="settings-default-transition" type="number" min="120" step="50" class="${inputCls} w-24 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Стартовое состояние</span>
          <select id="settings-boot-mood" class="${inputCls} w-36 text-right">
            <option value="neutral">Нейтральное</option>
            <option value="thinking">Размышление</option>
            <option value="waiting">Ожидание</option>
            <option value="success">Успех</option>
            <option value="friendly">Дружелюбное</option>
            <option value="planning">Планирование</option>
            <option value="coding">Кодинг</option>
            <option value="researching">Исследование</option>
            <option value="warning">Предупреждение</option>
            <option value="creative">Креатив</option>
            <option value="offline">Офлайн</option>
            <option value="error">Ошибка</option>
          </select>
        </div>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-autonomous-mode" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Автономный режим</span>
          </label>
        </div>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-context-guard-enabled" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">System plugin: Context Guard</span>
          </label>
        </div>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-context-autocompress" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Авто-сжатие контекста</span>
          </label>
        </div>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-context-chat-events" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Показывать события Context Guard в чате</span>
          </label>
        </div>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-model-fallback-enabled" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Авто-fallback модели при ошибках</span>
          </label>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Профиль fallback</span>
          <select id="settings-model-fallback-profile" class="${inputCls} w-44 text-right">
            <option value="conservative">Консервативный</option>
            <option value="balanced">Сбалансированный</option>
            <option value="aggressive">Агрессивный</option>
          </select>
        </div>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-model-scenario-autoadjust" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Автоприменение сценарного профиля модели</span>
          </label>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Профиль модели</span>
          <select id="settings-model-scenario-profile" class="${inputCls} w-44 text-right">
            <option value="auto">Авто</option>
            <option value="fast">Быстрый</option>
            <option value="precise">Точный</option>
            <option value="long_context">Длинный контекст</option>
          </select>
        </div>
      </article>

      <article data-settings-section="server" class="settings-section hidden space-y-3">
        <section class="rounded-xl border border-zinc-800/60 bg-zinc-950/50">
          <div class="border-b border-zinc-800/60 px-3.5 py-2.5">
            <p class="text-xs uppercase tracking-[0.12em] text-zinc-500">Режим работы</p>
          </div>
          <div class="space-y-3 px-3.5 py-3">
            <select id="settings-deployment-mode" class="${inputCls} w-full min-w-[260px]">
                <option value="local">Локально (без аккаунтов)</option>
                <option value="remote_client">Через удалённый сервер (клиент)</option>
                <option value="remote_server">Сам удалённый сервер</option>
            </select>
            <p id="settings-server-mode-hint" class="text-xs text-zinc-500">Выберите, как будет работать приложение: локально, как клиент или как сервер.</p>
          </div>
        </section>

        <section class="rounded-xl border border-zinc-800/60 bg-zinc-950/50">
          <div class="border-b border-zinc-800/60 px-3.5 py-2.5">
            <p class="text-xs uppercase tracking-[0.12em] text-zinc-500">Подключение к backend</p>
          </div>
          <div class="space-y-3 px-3.5 py-3">
            <div class="flex flex-wrap gap-2">
              <input id="settings-backend-url" type="text" placeholder="http://127.0.0.1:5055" class="${inputCls} min-w-[260px] flex-1" />
              <input id="settings-api-key" type="password" autocomplete="off" placeholder="Токен доступа (опционально)" class="${inputCls} min-w-[220px] flex-1" />
              <input id="settings-timeout-ms" type="number" min="500" step="100" class="${inputCls} w-28 text-right" />
              <button id="settings-test-connection" type="button"
                class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800">
                ${icon("inspector")}
                <span>Проверить</span>
              </button>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label class="inline-flex items-center gap-2 text-xs text-zinc-400">
                <input id="settings-auto-reconnect" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
                <span>Автоматически проверять соединение</span>
              </label>
              <div class="flex items-center gap-2">
                <span id="settings-connection-badge" class="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">не проверен</span>
                <p id="settings-connection-meta" class="text-xs text-zinc-600">Сервер не проверялся</p>
              </div>
            </div>
          </div>
        </section>

        <section class="rounded-xl border border-zinc-800/60 bg-zinc-950/50">
          <div class="border-b border-zinc-800/60 px-3.5 py-2.5">
            <p class="text-xs uppercase tracking-[0.12em] text-zinc-500">Аккаунт и доступ</p>
          </div>
          <div class="space-y-3 px-3.5 py-3">
            <div id="settings-server-auth-status-row" class="flex items-center justify-between gap-3">
              <span class="${labelCls}">Статус авторизации</span>
              <span id="settings-auth-status" class="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">unknown</span>
            </div>

            <div id="settings-server-registration-row" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/20 px-2.5 py-2">
              <span class="text-xs text-zinc-500">Публичная регистрация</span>
              <label class="flex items-center gap-2 cursor-pointer">
                <input id="settings-server-allow-registration" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
                <span class="text-xs text-zinc-300">Разрешить регистрацию новых пользователей</span>
              </label>
            </div>

            <div id="settings-server-bootstrap-panel" class="space-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/20 px-2.5 py-2.5">
              <p class="text-xs uppercase tracking-[0.12em] text-zinc-500">Инициализация первого администратора</p>
              <div class="flex flex-wrap gap-2">
                <input id="settings-bootstrap-username" type="text" placeholder="admin" class="${inputCls} flex-1 min-w-[140px]" />
                <input id="settings-bootstrap-password" type="password" placeholder="пароль админа" class="${inputCls} flex-1 min-w-[160px]" />
                <button id="settings-bootstrap-admin" type="button"
                  class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-800">
                  ${icon("shield-check")}
                  <span>Создать администратора</span>
                </button>
              </div>
            </div>

            <div id="settings-server-session-panel" class="space-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/20 px-2.5 py-2.5">
              <p class="text-xs uppercase tracking-[0.12em] text-zinc-500">Сессия</p>
              <div class="flex flex-wrap gap-2">
                <input id="settings-login-username" type="text" placeholder="логин" class="${inputCls} flex-1 min-w-[140px]" />
                <input id="settings-login-password" type="password" placeholder="пароль" class="${inputCls} flex-1 min-w-[160px]" />
                <button id="settings-login-button" type="button"
                  class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-800">
                  ${icon("check")}
                  <span>Войти</span>
                </button>
                <button id="settings-register-button" type="button"
                  class="icon-button active:scale-95 duration-300 rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300 transition hover:bg-emerald-950/40">
                  ${icon("chat-plus")}
                  <span>Регистрация</span>
                </button>
                <button id="settings-logout-button" type="button"
                  class="icon-button active:scale-95 duration-300 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-950/50">
                  ${icon("x-mark")}
                  <span>Выйти</span>
                </button>
              </div>
              <p id="settings-auth-user" class="text-xs text-zinc-500">Не авторизован</p>
            </div>
          </div>
        </section>

        <section id="settings-server-users-panel" class="rounded-xl border border-zinc-800/60 bg-zinc-950/50">
          <div class="flex items-center justify-between gap-2 border-b border-zinc-800/60 px-3.5 py-2.5">
            <p class="text-xs uppercase tracking-[0.12em] text-zinc-500">Управление пользователями</p>
            <button id="settings-users-refresh" type="button"
              class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800">
              ${icon("refresh")}
              <span>Обновить</span>
            </button>
          </div>
          <div class="space-y-2 px-3.5 py-3">
            <div class="flex flex-wrap gap-2">
              <input id="settings-create-user-username" type="text" placeholder="новый логин" class="${inputCls} flex-1 min-w-[140px]" />
              <input id="settings-create-user-password" type="password" placeholder="пароль" class="${inputCls} flex-1 min-w-[140px]" />
              <select id="settings-create-user-role" class="${inputCls} w-28">
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <button id="settings-create-user-button" type="button"
                class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-800">
                ${icon("chat-plus")}
                <span>Добавить</span>
              </button>
            </div>
            <div class="flex flex-wrap gap-3">
              <label class="inline-flex items-center gap-2 text-xs text-zinc-400">
                <input id="settings-create-user-model-download" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
                <span>Разрешить загрузку моделей</span>
              </label>
              <label class="inline-flex items-center gap-2 text-xs text-zinc-400">
                <input id="settings-create-user-plugin-download" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
                <span>Разрешить загрузку плагинов</span>
              </label>
            </div>
            <div id="settings-users-list" class="space-y-1.5"></div>
          </div>
        </section>

        <section id="settings-server-audit-panel" class="rounded-xl border border-zinc-800/60 bg-zinc-950/50">
          <div class="flex items-center justify-between gap-2 border-b border-zinc-800/60 px-3.5 py-2.5">
            <p class="text-xs uppercase tracking-[0.12em] text-zinc-500">Аудит действий</p>
            <button id="settings-audit-refresh" type="button"
              class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800">
              ${icon("refresh")}
              <span>Обновить</span>
            </button>
          </div>
          <div class="space-y-2 px-3.5 py-3">
            <div class="flex flex-wrap gap-2">
              <input id="settings-audit-action-prefix" type="text" placeholder="Фильтр действия (например plugin.)" class="${inputCls} flex-1 min-w-[200px]" />
              <input id="settings-audit-actor-user-id" type="text" placeholder="ID пользователя (опционально)" class="${inputCls} flex-1 min-w-[170px]" />
              <select id="settings-audit-status" class="${inputCls} w-32">
                <option value="all">all</option>
                <option value="ok">ok</option>
                <option value="error">error</option>
                <option value="denied">denied</option>
              </select>
              <select id="settings-audit-limit" class="${inputCls} w-28">
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200" selected>200</option>
                <option value="500">500</option>
              </select>
            </div>
            <p id="settings-audit-meta" class="text-xs text-zinc-600">Аудит не загружен.</p>
            <div id="settings-audit-list" class="max-h-72 space-y-1.5 overflow-y-auto pr-1"></div>
          </div>
        </section>
      </article>

      <article data-settings-section="about" class="settings-section hidden rounded-xl border border-zinc-800/60 divide-y divide-zinc-800/60">
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Приложение</span>
          <span class="text-sm text-zinc-200">Ancia</span>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Версия</span>
          <span class="font-mono text-sm text-zinc-200">0.1.0</span>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Стек</span>
          <span class="font-mono text-xs text-zinc-400">Vite · Tailwind · Tauri · Python</span>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Горячие клавиши</span>
          <span class="font-mono text-xs text-zinc-400">1/2/3 — разделы · Cmd+S — сохранить</span>
        </div>
        <div class="px-3.5 py-2.5 flex justify-end">
          <button id="settings-reset-all" type="button"
            class="icon-button active:scale-95 duration-300 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-950/60">
            ${icon("trash")}
            <span>Сбросить все настройки</span>
          </button>
        </div>
      </article>

    </section>
  </main>
`;
