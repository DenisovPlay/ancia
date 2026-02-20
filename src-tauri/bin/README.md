Place packaged backend binaries here for release builds:

- macOS: src-tauri/bin/ancia-backend
- Windows: src-tauri/bin/ancia-backend.exe

Tauri copies this folder as app resources. Runtime autostart in src-tauri/src/main.rs expects the backend sidecar at resource path `bin/ancia-backend`.
