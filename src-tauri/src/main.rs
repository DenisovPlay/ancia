#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::Manager;
use tauri::window::Color;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::window::{Effect, EffectState, EffectsBuilder};

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT_DEFAULT: u16 = 5055;
const BACKEND_PORT_FALLBACK_MAX: u16 = 5072;
const BACKEND_CONNECT_TIMEOUT: Duration = Duration::from_millis(900);
const BACKEND_CONNECT_RECHECK_TIMEOUT: Duration = Duration::from_millis(1500);
const BACKEND_STARTUP_WAIT_TIMEOUT: Duration = Duration::from_secs(18);
const BACKEND_STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(180);
const BACKEND_HEALTH_PATH: &str = "/health";
const SPLASH_FAILSAFE_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BackendProbeState {
    Unreachable,
    Healthy,
    OccupiedByOtherService,
}

#[derive(Debug, Clone, Serialize)]
struct BackendStartupSnapshot {
    status: String,
    message: String,
    host: String,
    port: u16,
}

impl Default for BackendStartupSnapshot {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            message: "Ожидание запуска backend...".to_string(),
            host: BACKEND_HOST.to_string(),
            port: BACKEND_PORT_DEFAULT,
        }
    }
}

struct BackendProcessState {
    child: Mutex<Option<Child>>,
    startup: Mutex<BackendStartupSnapshot>,
}

impl Default for BackendProcessState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            startup: Mutex::new(BackendStartupSnapshot::default()),
        }
    }
}

impl BackendProcessState {
    fn store_child(&self, child: Child) {
        if let Ok(mut guard) = self.child.lock() {
            Self::kill_child_gracefully(&mut guard);
            *guard = Some(child);
        }
    }

    fn running(&self) -> bool {
        let Ok(mut guard) = self.child.lock() else {
            return false;
        };

        let Some(child) = guard.as_mut() else {
            return false;
        };

        match child.try_wait() {
            Ok(Some(_status)) => {
                let _ = guard.take();
                false
            }
            Ok(None) => true,
            Err(_error) => {
                let _ = guard.take();
                false
            }
        }
    }

    fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            Self::kill_child_gracefully(&mut guard);
        }
        self.set_startup_status("stopped", "Локальный backend остановлен.");
    }

    fn kill_child_gracefully(child_opt: &mut Option<Child>) {
        let Some(mut child) = child_opt.take() else {
            return;
        };
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        let pid = child.id();
        terminate_pid_soft(pid);
        for _ in 0..16 {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(125));
        }
        if let Ok(None) = child.try_wait() {
            let _ = child.kill();
        }
        let _ = child.wait();
    }

    fn set_startup_status(&self, status: &str, message: impl Into<String>) {
        if let Ok(mut guard) = self.startup.lock() {
            guard.status = status.to_string();
            guard.message = message.into();
            if guard.host.trim().is_empty() {
                guard.host = BACKEND_HOST.to_string();
            }
            if guard.port == 0 {
                guard.port = BACKEND_PORT_DEFAULT;
            }
        }
    }

    fn set_startup_status_with_endpoint(
        &self,
        status: &str,
        message: impl Into<String>,
        host: &str,
        port: u16,
    ) {
        if let Ok(mut guard) = self.startup.lock() {
            guard.status = status.to_string();
            guard.message = message.into();
            guard.host = normalize_backend_host(host);
            guard.port = normalize_backend_port(port);
        }
    }

    fn startup_snapshot(&self) -> BackendStartupSnapshot {
        self.startup
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_else(|_| BackendStartupSnapshot {
                status: "error".to_string(),
                message: "Не удалось прочитать состояние запуска backend.".to_string(),
                host: BACKEND_HOST.to_string(),
                port: BACKEND_PORT_DEFAULT,
            })
    }
}

impl Drop for BackendProcessState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            BackendProcessState::kill_child_gracefully(&mut guard);
        }
    }
}

#[tauri::command]
fn backend_status(state: tauri::State<'_, BackendProcessState>) -> String {
    let snapshot = state.startup_snapshot();
    let host = normalize_backend_host(&snapshot.host);
    let port = normalize_backend_port(snapshot.port);
    if state.running() || is_backend_healthy(&host, port) {
        "running".to_string()
    } else {
        "stopped".to_string()
    }
}

#[tauri::command]
fn backend_startup_snapshot(
    state: tauri::State<'_, BackendProcessState>,
) -> BackendStartupSnapshot {
    let mut snapshot = state.startup_snapshot();
    snapshot.host = normalize_backend_host(&snapshot.host);
    snapshot.port = normalize_backend_port(snapshot.port);
    if snapshot.status == "ready"
        && !state.running()
        && !is_backend_healthy(&snapshot.host, snapshot.port)
    {
        snapshot.status = "stopped".to_string();
        snapshot.message = "Локальный backend остановлен.".to_string();
    }
    snapshot
}

#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("cmd")
        .arg("/c")
        .arg("start")
        .arg("")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "window 'main' not found".to_string())?;
    let _ = window.unminimize();
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(120));
        if let Some(splash) = app_handle.get_webview_window("splash") {
            let _ = splash.close();
        }
    });
    Ok(())
}

fn normalize_backend_host(host: &str) -> String {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        BACKEND_HOST.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_backend_port(port: u16) -> u16 {
    if port == 0 {
        BACKEND_PORT_DEFAULT
    } else {
        port
    }
}

fn backend_url(host: &str, port: u16) -> String {
    format!(
        "http://{}:{}",
        normalize_backend_host(host),
        normalize_backend_port(port)
    )
}

fn backend_addr(host: &str, port: u16) -> SocketAddr {
    let normalized_host = normalize_backend_host(host);
    let normalized_port = normalize_backend_port(port);
    if normalized_host.eq_ignore_ascii_case("localhost") || normalized_host == "127.0.0.1" {
        SocketAddr::from(([127, 0, 0, 1], normalized_port))
    } else {
        format!("{normalized_host}:{normalized_port}")
            .parse::<SocketAddr>()
            .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], normalized_port)))
    }
}

fn probe_backend_state(host: &str, port: u16, timeout: Duration) -> BackendProbeState {
    let mut stream = match TcpStream::connect_timeout(&backend_addr(host, port), timeout) {
        Ok(stream) => stream,
        Err(_) => return BackendProbeState::Unreachable,
    };

    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let normalized_host = normalize_backend_host(host);
    let normalized_port = normalize_backend_port(port);
    let request = format!(
        "GET {BACKEND_HEALTH_PATH} HTTP/1.1\r\nHost: {normalized_host}:{normalized_port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return BackendProbeState::Unreachable;
    }

    let mut response_bytes = [0_u8; 4096];
    let response_size = match stream.read(&mut response_bytes) {
        Ok(size) if size > 0 => size,
        _ => return BackendProbeState::Unreachable,
    };
    let response = String::from_utf8_lossy(&response_bytes[..response_size]);
    let http_ok = response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200");
    let service_ok = response.contains("\"service\":\"ancia-local-backend\"")
        || response.contains("\"service\": \"ancia-local-backend\"");

    if http_ok && service_ok {
        BackendProbeState::Healthy
    } else {
        BackendProbeState::OccupiedByOtherService
    }
}

fn is_backend_healthy(host: &str, port: u16) -> bool {
    probe_backend_state(host, port, BACKEND_CONNECT_TIMEOUT) == BackendProbeState::Healthy
}

fn terminate_pid_soft(pid: u32) {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/T")
            .status();
    }
}

fn resolve_app_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    match app.path().app_data_dir() {
        Ok(path) => {
            if let Err(error) = fs::create_dir_all(&path) {
                eprintln!("[ancia] failed to create app data dir: {error}");
            }
            Some(path)
        }
        Err(error) => {
            eprintln!("[ancia] failed to resolve app data dir: {error}");
            None
        }
    }
}

fn spawn_child(mut command: Command) -> Result<Child, String> {
    command.stdin(Stdio::null());
    if cfg!(debug_assertions) {
        command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else {
        command.stdout(Stdio::null()).stderr(Stdio::null());
    }

    command.spawn().map_err(|error| error.to_string())
}

enum BackendStartupDecision {
    UseExisting(u16),
    Spawn(u16),
}

fn pick_backend_port(host: &str) -> Result<BackendStartupDecision, String> {
    match probe_backend_state(host, BACKEND_PORT_DEFAULT, BACKEND_CONNECT_TIMEOUT) {
        BackendProbeState::Healthy => {
            return Ok(BackendStartupDecision::UseExisting(BACKEND_PORT_DEFAULT))
        }
        BackendProbeState::Unreachable => {
            // Avoid false-negative probes on slow startup by retrying once.
            if probe_backend_state(host, BACKEND_PORT_DEFAULT, BACKEND_CONNECT_RECHECK_TIMEOUT)
                == BackendProbeState::Healthy
            {
                return Ok(BackendStartupDecision::UseExisting(BACKEND_PORT_DEFAULT));
            }
            return Ok(BackendStartupDecision::Spawn(BACKEND_PORT_DEFAULT));
        }
        BackendProbeState::OccupiedByOtherService => {}
    }

    let mut free_fallback_port: Option<u16> = None;
    for candidate_port in (BACKEND_PORT_DEFAULT + 1)..=BACKEND_PORT_FALLBACK_MAX {
        match probe_backend_state(host, candidate_port, BACKEND_CONNECT_TIMEOUT) {
            BackendProbeState::Healthy => {
                return Ok(BackendStartupDecision::UseExisting(candidate_port))
            }
            BackendProbeState::Unreachable => {
                free_fallback_port.get_or_insert(candidate_port);
            }
            BackendProbeState::OccupiedByOtherService => {}
        }
    }

    if let Some(port) = free_fallback_port {
        return Ok(BackendStartupDecision::Spawn(port));
    }

    Err(format!(
        "Не удалось найти свободный порт для backend в диапазоне {}-{}.",
        BACKEND_PORT_DEFAULT, BACKEND_PORT_FALLBACK_MAX
    ))
}

fn try_spawn_dev_backend(
    project_root: &Path,
    app_data_dir: Option<&Path>,
    host: &str,
    port: u16,
) -> Result<Child, String> {
    let mut candidates: Vec<PathBuf> = vec![];

    #[cfg(target_os = "windows")]
    {
        candidates.push(
            project_root
                .join(".venv")
                .join("Scripts")
                .join("python.exe"),
        );
        candidates.push(PathBuf::from("python"));
        candidates.push(PathBuf::from("py"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        candidates.push(project_root.join(".venv").join("bin").join("python3"));
        candidates.push(project_root.join(".venv").join("bin").join("python"));
        candidates.push(PathBuf::from("python3"));
        candidates.push(PathBuf::from("python"));
    }

    let mut last_error = String::from("no backend command candidates available");

    for executable in candidates {
        let mut command = Command::new(&executable);
        #[cfg(target_os = "windows")]
        if executable == PathBuf::from("py") {
            command.arg("-3");
        }
        command
            .arg("-m")
            .arg("uvicorn")
            .arg("backend.main:app")
            .arg("--host")
            .arg(host)
            .arg("--port")
            .arg(port.to_string())
            .current_dir(project_root)
            .env("ANCIA_BACKEND_HOST", host)
            .env("ANCIA_BACKEND_PORT", port.to_string())
            .env("PYTHONUNBUFFERED", "1");

        if let Some(dir) = app_data_dir {
            command.env("ANCIA_BACKEND_DATA_DIR", dir);
        }

        match spawn_child(command) {
            Ok(child) => return Ok(child),
            Err(error) => {
                last_error = format!("{executable:?}: {error}");
            }
        }
    }

    Err(last_error)
}

fn try_spawn_release_backend(
    app: &tauri::AppHandle,
    app_data_dir: Option<&Path>,
    host: &str,
    port: u16,
) -> Result<Child, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("resource_dir: {error}"))?;

    let executable_name = if cfg!(target_os = "windows") {
        "ancia-backend.exe"
    } else {
        "ancia-backend"
    };
    let sidecar_path = resource_dir.join("bin").join(executable_name);

    if !sidecar_path.exists() {
        return Err(format!(
            "sidecar not found: {} (expected backend binary in src-tauri/bin during build)",
            sidecar_path.display()
        ));
    }

    let mut command = Command::new(&sidecar_path);
    command
        .env("ANCIA_BACKEND_HOST", host)
        .env("ANCIA_BACKEND_PORT", port.to_string());

    if let Some(dir) = app_data_dir {
        command.env("ANCIA_BACKEND_DATA_DIR", dir);
    }

    spawn_child(command)
}

fn wait_for_backend_ready(
    child: &mut Child,
    host: &str,
    port: u16,
    timeout: Duration,
) -> Result<(), String> {
    let started_at = Instant::now();
    while started_at.elapsed() < timeout {
        match probe_backend_state(host, port, BACKEND_CONNECT_TIMEOUT) {
            BackendProbeState::Healthy => return Ok(()),
            BackendProbeState::OccupiedByOtherService => {
                return Err(format!(
                    "port {host}:{port} is occupied by another service (not Ancia backend)"
                ));
            }
            BackendProbeState::Unreachable => {}
        }
        if let Ok(Some(status)) = child.try_wait() {
            let hint = if cfg!(debug_assertions) {
                " (подсказка: активируй venv и установи `pip install -r requirements.txt`)"
            } else {
                ""
            };
            return Err(format!(
                "backend exited immediately with status {status}{hint}"
            ));
        }
        std::thread::sleep(BACKEND_STARTUP_POLL_INTERVAL);
    }
    Err(format!(
        "backend did not open {host}:{port} within {}s",
        timeout.as_secs()
    ))
}

fn start_backend_if_needed(
    app: &tauri::AppHandle,
    state: &BackendProcessState,
) -> Result<(), String> {
    let startup_snapshot = state.startup_snapshot();
    let host = normalize_backend_host(&startup_snapshot.host);
    let startup_port = normalize_backend_port(startup_snapshot.port);
    state.set_startup_status_with_endpoint(
        "starting",
        "Проверяем состояние локального backend...",
        &host,
        startup_port,
    );

    if state.running() {
        if is_backend_healthy(&host, startup_port) {
            eprintln!(
                "[ancia] backend already running on {}:{}",
                host, startup_port
            );
            state.set_startup_status_with_endpoint(
                "ready",
                format!(
                    "Локальный backend уже активен на {}.",
                    backend_url(&host, startup_port)
                ),
                &host,
                startup_port,
            );
            return Ok(());
        }
        let error_text = format!(
            "backend process is alive but does not pass health check on {}",
            backend_url(&host, startup_port)
        );
        state.set_startup_status_with_endpoint("error", error_text.clone(), &host, startup_port);
        return Err(error_text);
    }

    let (selected_port, should_spawn) = match pick_backend_port(&host) {
        Ok(BackendStartupDecision::UseExisting(port)) => (port, false),
        Ok(BackendStartupDecision::Spawn(port)) => (port, true),
        Err(error) => {
            state.set_startup_status_with_endpoint("error", error.clone(), &host, startup_port);
            return Err(error);
        }
    };

    if !should_spawn {
        eprintln!(
            "[ancia] backend already running on {}:{}",
            host, selected_port
        );
        state.set_startup_status_with_endpoint(
            "ready",
            format!(
                "Локальный backend уже активен на {}.",
                backend_url(&host, selected_port)
            ),
            &host,
            selected_port,
        );
        return Ok(());
    }

    let launch_message = if selected_port == BACKEND_PORT_DEFAULT {
        "Запускаем локальный backend...".to_string()
    } else {
        format!(
            "Порт {} занят сторонним сервисом. Переключаем backend на порт {}.",
            BACKEND_PORT_DEFAULT, selected_port
        )
    };
    state.set_startup_status_with_endpoint("starting", launch_message, &host, selected_port);
    if state.running() {
        let error_text = "Невозможно запустить backend: процесс уже выполняется.".to_string();
        state.set_startup_status_with_endpoint("error", error_text.clone(), &host, selected_port);
        return Err(error_text);
    }

    let app_data_dir = resolve_app_data_dir(app);

    let mut child = if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(manifest_dir);

        match try_spawn_dev_backend(&project_root, app_data_dir.as_deref(), &host, selected_port) {
            Ok(child) => child,
            Err(error) => {
                state.set_startup_status_with_endpoint(
                    "error",
                    format!("Не удалось запустить backend в dev-режиме: {error}"),
                    &host,
                    selected_port,
                );
                return Err(error);
            }
        }
    } else {
        match try_spawn_release_backend(app, app_data_dir.as_deref(), &host, selected_port) {
            Ok(child) => child,
            Err(error) => {
                state.set_startup_status_with_endpoint(
                    "error",
                    format!("Не удалось запустить backend sidecar: {error}"),
                    &host,
                    selected_port,
                );
                return Err(error);
            }
        }
    };

    state.set_startup_status_with_endpoint(
        "starting",
        "Ожидаем готовность backend...",
        &host,
        selected_port,
    );
    if let Err(error) = wait_for_backend_ready(
        &mut child,
        &host,
        selected_port,
        BACKEND_STARTUP_WAIT_TIMEOUT,
    ) {
        state.set_startup_status_with_endpoint("error", error.clone(), &host, selected_port);
        return Err(error);
    }

    // Handle startup races: another Ancia backend may have bound the port first.
    std::thread::sleep(Duration::from_millis(120));
    if let Ok(Some(status)) = child.try_wait() {
        if is_backend_healthy(&host, selected_port) {
            state.set_startup_status_with_endpoint(
                "ready",
                format!(
                    "Локальный backend уже активен на {}.",
                    backend_url(&host, selected_port)
                ),
                &host,
                selected_port,
            );
            eprintln!(
                "[ancia] backend startup race resolved: using existing backend on {}",
                backend_url(&host, selected_port)
            );
            return Ok(());
        }
        let error_text = format!("backend exited during startup with status {status}");
        state.set_startup_status_with_endpoint("error", error_text.clone(), &host, selected_port);
        return Err(error_text);
    }

    state.store_child(child);
    state.set_startup_status_with_endpoint(
        "ready",
        format!(
            "Локальный backend готов на {}.",
            backend_url(&host, selected_port)
        ),
        &host,
        selected_port,
    );
    eprintln!(
        "[ancia] backend process started and is listening on {}",
        backend_url(&host, selected_port)
    );
    Ok(())
}

fn configure_startup_windows(app: &tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.set_background_color(Some(Color(5, 8, 22, 255)));
    }

    if let Some(splash_window) = app.get_webview_window("splash") {
        let _ = splash_window.set_background_color(Some(Color(5, 8, 22, 8)));

        #[cfg(target_os = "macos")]
        {
            let _ = splash_window.set_effects(
                EffectsBuilder::new()
                    .effect(Effect::Popover)
                    .state(EffectState::Active)
                    .radius(22.0)
                    .build(),
            );
            let _ = splash_window.set_shadow(true);
        }

        #[cfg(target_os = "windows")]
        {
            let _ = splash_window.set_effects(
                EffectsBuilder::new()
                    .effect(Effect::Blur)
                    .color(Color(5, 8, 22, 228))
                    .build(),
            );
            let _ = splash_window.set_shadow(true);
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(BackendProcessState::default())
        .setup(|app| {
            configure_startup_windows(app.handle());
            let app_handle = app.handle().clone();
            let app_handle_for_failsafe = app.handle().clone();
            std::thread::spawn(move || {
                let state = app_handle.state::<BackendProcessState>();
                if let Err(error) = start_backend_if_needed(&app_handle, state.inner()) {
                    eprintln!("[ancia] backend autostart failed: {error}");
                }
            });
            std::thread::spawn(move || {
                std::thread::sleep(SPLASH_FAILSAFE_TIMEOUT);
                let should_reveal_main = app_handle_for_failsafe
                    .get_webview_window("main")
                    .and_then(|window| window.is_visible().ok().map(|visible| (window, visible)));

                if let Some((window, false)) = should_reveal_main {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                if let Some(splash) = app_handle_for_failsafe.get_webview_window("splash") {
                    let _ = splash.close();
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                let state = window.state::<BackendProcessState>();
                state.stop();
            }
        })
        .invoke_handler(tauri::generate_handler![
            backend_status,
            backend_startup_snapshot,
            open_in_browser,
            show_main_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
