//! doXmind desktop shell.
//!
//! Lifecycle:
//!   1. On startup, pick a free TCP port on 127.0.0.1.
//!   2. Spawn the FastAPI sidecar with PORT=<that port>.
//!      - Release: tauri-plugin-shell sidecar (bundled `doxmind-server` binary).
//!      - Debug:   `python -m uvicorn run_sidecar:main` from the repo's
//!                 `server/` directory using the venv interpreter when present.
//!   3. Inject `window.__TAURI_BACKEND_URL__` into every WebView before any
//!      page script runs (see `init_script` on the WindowBuilder).
//!   4. On exit, kill the sidecar so we don't leave an orphaned uvicorn.

use std::net::TcpListener;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

#[cfg(target_os = "macos")]
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter,
};

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::AnyThread;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSImage};
#[cfg(target_os = "macos")]
use objc2_foundation::{MainThreadMarker, NSData};

#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

#[cfg(debug_assertions)]
use std::path::PathBuf;
#[cfg(debug_assertions)]
use std::process::{Child, Command};

/// Holds the running backend process so we can kill it cleanly on exit.
struct Backend {
    #[cfg(not(debug_assertions))]
    child: Mutex<Option<CommandChild>>,
    #[cfg(debug_assertions)]
    child: Mutex<Option<Child>>,
}

impl Backend {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

/// Ask the kernel for a free port by binding to :0 and reading it back.
fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind probe socket")
        .local_addr()
        .expect("failed to read probe socket addr")
        .port()
}

/// In dev mode, find a usable Python interpreter — preferring the project
/// venv at `server/.venv/bin/python` so editable installs are picked up.
#[cfg(debug_assertions)]
fn resolve_python(server_dir: &std::path::Path) -> PathBuf {
    if let Ok(explicit) = std::env::var("DOXMIND_PYTHON") {
        return PathBuf::from(explicit);
    }
    let venv = server_dir.join(".venv").join("bin").join("python");
    if venv.exists() {
        return venv;
    }
    PathBuf::from("python3")
}

#[cfg(debug_assertions)]
fn spawn_backend_dev(port: u16) -> Child {
    // The server lives at <repo-root>/server. In `tauri dev` the binary's
    // CWD is the repo root, so resolve relative to CARGO_MANIFEST_DIR (which
    // points at src-tauri/) and step up one level.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let server_dir = manifest_dir
        .parent()
        .expect("src-tauri must have a parent directory")
        .join("server");
    let python = resolve_python(&server_dir);

    log::info!(
        "[backend/dev] starting {} run_sidecar.py on port {} (cwd={})",
        python.display(),
        port,
        server_dir.display()
    );

    Command::new(python)
        .arg("run_sidecar.py")
        .current_dir(&server_dir)
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .spawn()
        .expect("failed to spawn dev backend (python run_sidecar.py)")
}

#[cfg(not(debug_assertions))]
fn spawn_backend_sidecar(app: &AppHandle, port: u16) -> CommandChild {
    let sidecar = app
        .shell()
        .sidecar("doxmind-server")
        .expect("doxmind-server sidecar binary not found in resources");

    log::info!("[backend] starting bundled sidecar on port {port}");

    let (_rx, child) = sidecar
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .spawn()
        .expect("failed to spawn doxmind-server sidecar");
    child
}

struct BackendUrl(String);

#[tauri::command]
fn get_backend_url(state: tauri::State<'_, BackendUrl>) -> String {
    state.0.clone()
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init()
        .ok();

    let port = pick_free_port();
    let backend_url = format!("http://127.0.0.1:{port}");
    log::info!("[backend] reserved {backend_url}");

    // Bootstrap script — runs in the WebView before any page script. This is
    // how the frontend's `getApiBase()` discovers the dynamic sidecar port,
    // and where we tag the document with a platform class so the custom
    // header can leave room for the macOS traffic-light buttons.
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    let init_script = format!(
        r#"window.__TAURI_BACKEND_URL__ = {url};
window.__TAURI_PLATFORM__ = "{platform}";
(function() {{
    var apply = function() {{
    if (!document.documentElement) return;
    document.documentElement.classList.add("is-tauri", "is-tauri-" + "{platform}");
    if ("{platform}" === "macos") {{
      document.documentElement.classList.add("macos-vibrancy");
    }}
  }};
  if (document.documentElement) apply();
  else document.addEventListener("DOMContentLoaded", apply, {{ once: true }});
}})();"#,
        url = serde_json::to_string(&backend_url).unwrap(),
        platform = platform,
    );

    let backend_state = Backend::new();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(BackendUrl(backend_url.clone()))
        .manage(backend_state)
        .invoke_handler(tauri::generate_handler![get_backend_url])
        .setup(move |app| {
            // Spawn the backend.
            #[cfg(debug_assertions)]
            {
                let child = spawn_backend_dev(port);
                let state: tauri::State<'_, Backend> = app.state();
                *state.child.lock().unwrap() = Some(child);
            }
            #[cfg(not(debug_assertions))]
            {
                let child = spawn_backend_sidecar(&app.handle(), port);
                let state: tauri::State<'_, Backend> = app.state();
                *state.child.lock().unwrap() = Some(child);
            }

            // Build the main window with the backend URL pre-injected. On
            // macOS, hide the title bar background and the title text so the
            // app's own header takes over — the traffic-light buttons stay
            // floating at the top-left and the in-page header gets enough
            // left padding (see .is-tauri-macos in the frontend) to clear
            // them.
            // Load the editor shell directly. The marketing/home surface was
            // removed, so desktop should boot into the local workspace rather
            // than flashing "/" and waiting for a client redirect.
            //
            // Use a trailing slash so the URL resolves to the editor index in
            // both modes:
            //   dev:  http://localhost:3000/editor/ (Next dev server)
            //   prod: tauri://localhost/editor/     (static editor route)
            // In dev mode the binary is normally launched by `tauri dev`,
            // which bakes the right `devUrl` into the compiled config. The
            // macOS dev flow (`scripts/desktop-dev.mjs`) takes a different
            // path: it builds the binary, wraps it in a thin .app so macOS
            // LaunchServices reports the correct bundle (and Mission Control
            // shows our logo as the corner badge), and launches the .app via
            // `open`. Compile-time config baking doesn't reach that .app, so
            // we let it pass the dev URL through `DOXMIND_DEV_URL` instead
            // (propagated via `LSEnvironment` in the wrapper's Info.plist).
            let webview_url = std::env::var("DOXMIND_DEV_URL")
                .ok()
                .filter(|s| !s.is_empty())
                .and_then(|raw| {
                    let trimmed = raw.trim_end_matches('/');
                    let full = format!("{trimmed}/editor/");
                    match full.parse::<tauri::Url>() {
                        Ok(url) => Some(WebviewUrl::External(url)),
                        Err(err) => {
                            log::warn!("[webview] ignoring invalid DOXMIND_DEV_URL ({raw}): {err}");
                            None
                        }
                    }
                })
                .unwrap_or_else(|| WebviewUrl::App("editor/".into()));

            let mut builder = WebviewWindowBuilder::new(app, "main", webview_url)
                .title("doXmind")
                .inner_size(1400.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .resizable(true)
                .initialization_script(&init_script);

            #[cfg(target_os = "macos")]
            {
                // Center the traffic lights vertically inside the 44px
                // chrome header so they align with the icon buttons that
                // sit immediately to the right of them. Tauri positions
                // the cluster at this offset from the window's top-left;
                // y is tuned visually rather than mathematically because
                // macOS adds extra padding around the cluster.
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .traffic_light_position(tauri::LogicalPosition::new(14.0, 24.0))
                    .hidden_title(true)
                    .transparent(true);
            }

            let window = builder.build()?;
            #[cfg(target_os = "macos")]
            {
                // corner_radius=None lets NSVisualEffectView fill the entire
                // window; passing Some(...) clips the vibrancy view to a
                // smaller rounded rect that may not cover the full sidebar.
                if let Err(err) = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::Active),
                    None,
                ) {
                    log::warn!("[window] failed to apply macOS vibrancy: {err}");
                }
            }
            // Show & focus once the WebView is ready (avoids the brief blank
            // flash you get with the default config).
            let _ = window.show();
            let _ = window.set_focus();

            #[cfg(target_os = "macos")]
            {
                apply_dock_icon();
                if let Err(err) = install_macos_tray(app.handle()) {
                    log::warn!("[tray] failed to install: {err}");
                }
            }

            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build tauri app");

    app.run(|handle, event| {
        if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
            shutdown_backend(handle);
        }
    });
}

/// Bytes of the master app logo. Embedded at compile time so the dock-tile
/// override works in `tauri dev` (where there is no .app bundle wrapper) as
/// well as in production builds.
#[cfg(target_os = "macos")]
const APP_ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

/// Decode the embedded PNG into an NSImage. Returns `None` if AppKit refuses
/// the data (should never happen for our static asset).
#[cfg(target_os = "macos")]
fn load_ns_image() -> Option<Retained<NSImage>> {
    let data = NSData::with_bytes(APP_ICON_PNG);
    NSImage::initWithData(NSImage::alloc(), &data)
}

/// Set the application icon at runtime. macOS uses this for the dock tile,
/// the Cmd+Tab switcher, AND as the bottom-right corner badge that Mission
/// Control / App Exposé / minimize-to-dock thumbnails draw on top of the
/// captured window snapshot — i.e. the "logo in the corner of the live
/// preview" effect. In `tauri dev` there is no .app bundle for macOS to read
/// CFBundleIconFile from, so without this call the dock and previews fall
/// back to a generic blue square.
#[cfg(target_os = "macos")]
fn apply_dock_icon() {
    let Some(mtm) = MainThreadMarker::new() else {
        log::warn!("[dock] skipping icon override — not on main thread");
        return;
    };
    let Some(image) = load_ns_image() else {
        log::warn!("[dock] failed to decode embedded icon.png");
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    unsafe { app.setApplicationIconImage(Some(&image)) };
}

#[cfg(target_os = "macos")]
fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Install the macOS menu-bar (tray) icon and dropdown menu.
///
/// The icon is a black-only template PNG; passing `icon_as_template(true)`
/// lets macOS recolor it to match the active menu bar appearance. Menu items
/// emit `tray://*` events that the frontend listens for to invoke the same
/// store actions the in-app UI uses (so we don't reimplement file creation
/// in Rust).
#[cfg(target_os = "macos")]
fn install_macos_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon_bytes = include_bytes!("../icons/tray-icon-template.png");
    let icon = Image::from_bytes(icon_bytes)?;

    let new_file = MenuItemBuilder::with_id("tray-new-file", "New Document")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let show = MenuItemBuilder::with_id("tray-show", "Open doXmind").build(app)?;
    let settings = MenuItemBuilder::with_id("tray-settings", "Settings…").build(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit doXmind"))?;

    let menu = MenuBuilder::new(app)
        .item(&new_file)
        .separator()
        .item(&show)
        .item(&settings)
        .separator()
        .item(&quit)
        .build()?;

    TrayIconBuilder::with_id("doxmind-tray")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("doXmind")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-new-file" => {
                focus_main_window(app);
                let _ = app.emit("tray://new-file", ());
            }
            "tray-show" => {
                focus_main_window(app);
            }
            "tray-settings" => {
                focus_main_window(app);
                let _ = app.emit("tray://settings", ());
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn shutdown_backend(app: &AppHandle) {
    if let Some(state) = app.try_state::<Backend>() {
        if let Ok(mut guard) = state.child.lock() {
            if let Some(child) = guard.take() {
                log::info!("[backend] terminating sidecar");
                #[cfg(debug_assertions)]
                {
                    let mut child = child;
                    let _ = child.kill();
                    let _ = child.wait();
                }
                #[cfg(not(debug_assertions))]
                {
                    let _ = child.kill();
                }
            }
        }
    }
}
