#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 5055;

#[derive(Default)]
struct BackendProcessState {
    child: Mutex<Option<Child>>,
}

impl BackendProcessState {
    fn store_child(&self, child: Child) {
        if let Ok(mut guard) = self.child.lock() {
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
            Err(_error) => false,
        }
    }

    fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for BackendProcessState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
fn backend_status(state: tauri::State<'_, BackendProcessState>) -> String {
    if state.running() || is_backend_online() {
        "running".to_string()
    } else {
        "stopped".to_string()
    }
}

#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("cmd").arg("/c").arg("start").arg("").arg(&url).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

fn backend_addr() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], BACKEND_PORT))
}

fn is_backend_online() -> bool {
    let timeout = Duration::from_millis(250);
    TcpStream::connect_timeout(&backend_addr(), timeout).is_ok()
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

fn try_spawn_dev_backend(
    project_root: &Path,
    app_data_dir: Option<&Path>,
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
        command
            .arg("-m")
            .arg("uvicorn")
            .arg("backend.main:app")
            .arg("--host")
            .arg(BACKEND_HOST)
            .arg("--port")
            .arg(BACKEND_PORT.to_string())
            .current_dir(project_root)
            .env("ANCIA_BACKEND_HOST", BACKEND_HOST)
            .env("ANCIA_BACKEND_PORT", BACKEND_PORT.to_string())
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
        .env("ANCIA_BACKEND_HOST", BACKEND_HOST)
        .env("ANCIA_BACKEND_PORT", BACKEND_PORT.to_string());

    if let Some(dir) = app_data_dir {
        command.env("ANCIA_BACKEND_DATA_DIR", dir);
    }

    spawn_child(command)
}

fn resolve_listening_pids(port: u16) -> Vec<u32> {
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("lsof")
            .arg("-nP")
            .arg("-iTCP")
            .arg(format!(":{port}"))
            .arg("-sTCP:LISTEN")
            .arg("-t")
            .output();

        let Ok(output) = output else {
            return vec![];
        };
        if !output.status.success() {
            return vec![];
        }

        return String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.trim().parse::<u32>().ok())
            .collect::<Vec<u32>>();
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("netstat").arg("-ano").output();
        let Ok(output) = output else {
            return vec![];
        };
        if !output.status.success() {
            return vec![];
        }

        let needle = format!(":{port}");
        return String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|line| line.contains("LISTENING") && line.contains(&needle))
            .filter_map(|line| line.split_whitespace().last())
            .filter_map(|token| token.parse::<u32>().ok())
            .collect::<Vec<u32>>();
    }
}

fn terminate_pid(pid: u32) {
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
            .arg("/F")
            .status();
    }
}

fn terminate_existing_backend_listener(port: u16) -> bool {
    let pids = resolve_listening_pids(port);
    if pids.is_empty() {
        return !is_backend_online();
    }

    for pid in pids {
        terminate_pid(pid);
    }

    for _ in 0..20 {
        if !is_backend_online() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(120));
    }

    false
}

fn start_backend_if_needed(
    app: &tauri::AppHandle,
    state: &BackendProcessState,
) -> Result<(), String> {
    if cfg!(debug_assertions) && is_backend_online() {
        eprintln!(
            "[ancia] dev mode: terminating stale backend listener on {BACKEND_HOST}:{BACKEND_PORT}"
        );
        state.stop();
        if !terminate_existing_backend_listener(BACKEND_PORT) {
            return Err(format!(
        "failed to terminate existing backend on {BACKEND_HOST}:{BACKEND_PORT}; free the port and retry"
      ));
        }
    } else if is_backend_online() {
        eprintln!("[ancia] backend already running on {BACKEND_HOST}:{BACKEND_PORT}");
        return Ok(());
    }

    let app_data_dir = resolve_app_data_dir(app);

    let mut child = if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(manifest_dir);

        try_spawn_dev_backend(&project_root, app_data_dir.as_deref())?
    } else {
        try_spawn_release_backend(app, app_data_dir.as_deref())?
    };

    std::thread::sleep(Duration::from_millis(650));
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

    state.store_child(child);
    eprintln!("[ancia] backend process started");
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(BackendProcessState::default())
        .setup(|app| {
            let state = app.state::<BackendProcessState>();
            if let Err(error) = start_backend_if_needed(&app.handle(), state.inner()) {
                eprintln!("[ancia] backend autostart failed: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let state = window.state::<BackendProcessState>();
                state.stop();
            }
        })
        .invoke_handler(tauri::generate_handler![backend_status, open_in_browser])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
