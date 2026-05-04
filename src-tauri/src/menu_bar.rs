//! macOS application menu bar (the menu strip across the top of the screen).
//!
//! Tauri's default menu only ships an App / Edit / Window / Help skeleton.
//! For a document IDE that's not enough — users expect File ▸ Open / Save /
//! Open Recent and View ▸ Toggle Sidebar. We build the whole menu here and
//! emit `menu://*` events that the frontend bridges into the same store
//! actions the in-app UI uses.
//!
//! `Open Recent` is rebuilt whenever the frontend pushes a new recents list
//! via `dock_set_recents`, so the submenu always matches the welcome screen
//! and the dock right-click menu.

#![cfg(target_os = "macos")]

use std::sync::OnceLock;

use serde::Serialize;
use tauri::menu::{
    AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::OpenTarget;

const RECENT_LIMIT: usize = 12;
const RECENT_ITEM_PREFIX: &str = "menu-recent-";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentPayload<'a> {
    kind: &'a str,
    path: &'a str,
}

static HANDLER_INSTALLED: OnceLock<()> = OnceLock::new();

/// Build and install the application menu. Safe to call once during setup.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, &[])?;
    app.set_menu(menu)?;

    if HANDLER_INSTALLED.set(()).is_ok() {
        let handle = app.clone();
        app.on_menu_event(move |_, event| handle_menu_event(&handle, event.id().as_ref()));
    }
    Ok(())
}

/// Rebuild the menu so `Open Recent` reflects the latest list.
pub fn refresh_recents(app: &AppHandle, recents: &[OpenTarget]) -> tauri::Result<()> {
    let menu = build_menu(app, recents)?;
    app.set_menu(menu)?;
    Ok(())
}

fn build_menu(app: &AppHandle, recents: &[OpenTarget]) -> tauri::Result<Menu<Wry>> {
    let app_submenu = {
        let about_md = AboutMetadataBuilder::new()
            .name(Some("doXmind".to_string()))
            .version(Some(env!("CARGO_PKG_VERSION").to_string()))
            .build();

        SubmenuBuilder::new(app, "doXmind")
            .item(&PredefinedMenuItem::about(
                app,
                Some("About doXmind"),
                Some(about_md),
            )?)
            .separator()
            .item(
                &MenuItemBuilder::with_id("menu-settings", "Settings…")
                    .accelerator("CmdOrCtrl+,")
                    .build(app)?,
            )
            .separator()
            .item(&PredefinedMenuItem::services(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .item(&PredefinedMenuItem::show_all(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, None)?)
            .build()?
    };

    let file_submenu = {
        let recent_submenu = {
            let mut builder = SubmenuBuilder::new(app, "Open Recent");
            let take = recents.len().min(RECENT_LIMIT);
            if take == 0 {
                let empty = MenuItemBuilder::with_id("menu-recent-empty", "No Recent Items")
                    .enabled(false)
                    .build(app)?;
                builder = builder.item(&empty);
            } else {
                for (idx, entry) in recents.iter().take(RECENT_LIMIT).enumerate() {
                    let label = recent_label(entry);
                    let id = format!("{RECENT_ITEM_PREFIX}{idx}");
                    let item = MenuItemBuilder::with_id(id, label).build(app)?;
                    builder = builder.item(&item);
                }
            }
            builder = builder.separator().item(
                &MenuItemBuilder::with_id("menu-clear-recents", "Clear Recents")
                    .enabled(take > 0)
                    .build(app)?,
            );
            builder.build()?
        };

        SubmenuBuilder::new(app, "File")
            .item(
                &MenuItemBuilder::with_id("menu-new-file", "New Document")
                    .accelerator("CmdOrCtrl+N")
                    .build(app)?,
            )
            .item(
                &MenuItemBuilder::with_id("menu-new-window", "New Window")
                    .accelerator("CmdOrCtrl+Shift+N")
                    .build(app)?,
            )
            .separator()
            .item(
                &MenuItemBuilder::with_id("menu-open-file", "Open File…")
                    .accelerator("CmdOrCtrl+O")
                    .build(app)?,
            )
            .item(
                &MenuItemBuilder::with_id("menu-open-folder", "Open Folder…")
                    .accelerator("CmdOrCtrl+Shift+O")
                    .build(app)?,
            )
            .item(&recent_submenu)
            .separator()
            .item(
                &MenuItemBuilder::with_id("menu-save", "Save")
                    .accelerator("CmdOrCtrl+S")
                    .build(app)?,
            )
            .separator()
            .item(
                &MenuItemBuilder::with_id("menu-reveal", "Reveal in Finder")
                    .accelerator("CmdOrCtrl+Alt+R")
                    .build(app)?,
            )
            .separator()
            .item(&PredefinedMenuItem::close_window(app, None)?)
            .build()?
    };

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("menu-find", "Find in Document…")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-quick-switcher", "Quick Switcher…")
                .accelerator("CmdOrCtrl+P")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-command-palette", "Command Palette…")
                .accelerator("CmdOrCtrl+K")
                .build(app)?,
        )
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("menu-toggle-sidebar", "Toggle Sidebar")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-toggle-focus", "Toggle Focus Mode")
                .accelerator("F11")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("menu-new-window-alt", "New Window")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?,
        )
        .build()?;

    let help_submenu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("menu-help-github", "doXmind on GitHub").build(app)?)
        .item(&MenuItemBuilder::with_id("menu-help-support", "Email Support").build(app)?)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()
}

fn recent_label(entry: &OpenTarget) -> String {
    let normalized = entry.path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    trimmed
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string())
        .unwrap_or_else(|| entry.path.clone())
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    if let Some(rest) = id.strip_prefix(RECENT_ITEM_PREFIX) {
        if let Ok(idx) = rest.parse::<usize>() {
            emit_recent(app, idx);
        }
        return;
    }

    match id {
        "menu-settings" => emit_to_focused(app, "menu://settings", ()),
        "menu-new-file" => {
            focus_some_window(app);
            let _ = app.emit("menu://new-file", ());
        }
        "menu-new-window" | "menu-new-window-alt" => {
            let _ = app.emit("menu://new-window", ());
        }
        "menu-open-file" => {
            focus_some_window(app);
            let _ = app.emit("menu://open-file", ());
        }
        "menu-open-folder" => {
            focus_some_window(app);
            let _ = app.emit("menu://open-folder", ());
        }
        "menu-clear-recents" => {
            let _ = app.emit("menu://clear-recents", ());
        }
        "menu-save" => emit_to_focused(app, "menu://save", ()),
        "menu-reveal" => emit_to_focused(app, "menu://reveal", ()),
        "menu-find" => emit_to_focused(app, "menu://find", ()),
        "menu-quick-switcher" => emit_to_focused(app, "menu://quick-switcher", ()),
        "menu-command-palette" => emit_to_focused(app, "menu://command-palette", ()),
        "menu-toggle-sidebar" => emit_to_focused(app, "menu://toggle-sidebar", ()),
        "menu-toggle-focus" => emit_to_focused(app, "menu://toggle-focus", ()),
        "menu-help-github" => {
            let _ = app.emit("menu://open-url", "https://github.com/doXmind".to_string());
        }
        "menu-help-support" => {
            let _ = app.emit(
                "menu://open-url",
                "mailto:support@waxis.org?subject=doXmind%20Support".to_string(),
            );
        }
        _ => {}
    }
}

fn emit_recent(app: &AppHandle, idx: usize) {
    let entry = crate::dock_menu::recent_at(idx);
    if let Some(entry) = entry {
        let payload = RecentPayload {
            kind: &entry.kind,
            path: &entry.path,
        };
        let _ = app.emit("menu://open-recent", payload);
    }
}

fn focus_some_window(app: &AppHandle) {
    if focused_window(app).is_some() {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn focused_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
}

fn emit_to_focused<P>(app: &AppHandle, event: &str, payload: P)
where
    P: Serialize + Clone,
{
    if let Some(window) = focused_window(app) {
        let _ = window.emit(event, payload);
    } else {
        let _ = app.emit(event, payload);
    }
}
