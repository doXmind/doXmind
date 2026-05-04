//! macOS dock right-click menu showing recent files and folders.
//!
//! Tauri 2 doesn't expose `applicationDockMenu:` directly, so we add it to
//! the existing NSApplicationDelegate at runtime via `class_addMethod`. The
//! menu items target a custom NSObject subclass (`DoxmindDockTarget`) whose
//! `openRecent:` action emits a Tauri event back to JS.
//!
//! Recents are pushed from the frontend on every change via the
//! `dock_set_recents` Tauri command and stored in a global Mutex. AppKit
//! calls `applicationDockMenu:` lazily on each right-click, so the menu
//! always reflects the latest state.

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::sync::{Mutex, OnceLock};

use objc2::define_class;
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, NSObject, Sel};
use objc2::sel;
use objc2::{ClassType, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem, NSWorkspace};
use objc2_foundation::{MainThreadMarker, NSSize, NSString};
use tauri::{AppHandle, Emitter};

use crate::OpenTarget;

// Low-level Objective-C runtime call. objc2 0.6 doesn't expose a public
// `add_method` on `&AnyClass`; the class-modification path is supposed to
// happen through `ClassBuilder` for *new* classes. We need to add a method
// to an *existing* class (Tauri's NSApplicationDelegate), so we fall back to
// the libobjc symbol directly.
#[link(name = "objc")]
unsafe extern "C" {
    fn class_addMethod(
        cls: *const AnyClass,
        name: Sel,
        imp: *const c_void,
        types: *const i8,
    ) -> bool;
}

static RECENTS: OnceLock<Mutex<Vec<OpenTarget>>> = OnceLock::new();
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static DOCK_TARGET: OnceLock<Retained<DoxmindDockTarget>> = OnceLock::new();

pub fn set_recents(recents: Vec<OpenTarget>) {
    let lock = RECENTS.get_or_init(|| Mutex::new(Vec::new()));
    if let Ok(mut guard) = lock.lock() {
        *guard = recents;
    }
}

/// Look up a single recent by index, used to resolve clicks on dynamically
/// generated `menu-recent-N` items in the application menu bar and tray.
pub fn recent_at(idx: usize) -> Option<OpenTarget> {
    RECENTS
        .get()
        .and_then(|m| m.lock().ok().and_then(|g| g.get(idx).cloned()))
}

/// Install `applicationDockMenu:` on the NSApplicationDelegate that Tauri
/// already set. Must run on the main thread, after the Tauri app has built
/// its delegate (i.e. inside `setup`).
pub fn install(app: AppHandle) -> Result<(), String> {
    let _ = APP_HANDLE.set(app);
    RECENTS.get_or_init(|| Mutex::new(Vec::new()));

    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "dock_menu::install must run on the main thread".to_string())?;

    let target = DoxmindDockTarget::new(mtm);
    let _ = DOCK_TARGET.set(target);

    let nsapp = NSApplication::sharedApplication(mtm);
    let delegate = nsapp
        .delegate()
        .ok_or_else(|| "NSApplication has no delegate".to_string())?;

    // Grab the delegate's *class* so the new method becomes available to all
    // future invocations on it. Adding to the instance directly isn't a thing
    // in Objective-C — methods live on classes.
    let cls_ptr: *const AnyClass = unsafe { msg_send![&*delegate, class] };
    if cls_ptr.is_null() {
        return Err("NSApplication delegate has no class".to_string());
    }

    let sel = sel!(applicationDockMenu:);
    // Type encoding: returns id (@), takes self (@), _cmd (:), NSApplication* (@).
    let types = c"@@:@".as_ptr();
    let imp = application_dock_menu as *const c_void;
    let added = unsafe { class_addMethod(cls_ptr, sel, imp, types) };
    if !added {
        let cls_name = unsafe { (&*cls_ptr).name() }
            .to_str()
            .unwrap_or("?")
            .to_string();
        log::warn!(
            "[dock] applicationDockMenu: already on {cls_name}; leaving it untouched"
        );
    }
    Ok(())
}

extern "C" fn application_dock_menu(
    _self_obj: *mut AnyObject,
    _cmd: Sel,
    _app: *mut AnyObject,
) -> *mut NSMenu {
    let Some(mtm) = MainThreadMarker::new() else {
        return std::ptr::null_mut();
    };

    let recents = RECENTS
        .get()
        .and_then(|m| m.lock().ok().map(|g| g.clone()))
        .unwrap_or_default();

    let menu = NSMenu::new(mtm);
    let target = match DOCK_TARGET.get() {
        Some(t) => t,
        None => return autorelease_into_raw(menu),
    };
    let target_obj: &AnyObject = {
        let ns: &NSObject = AsRef::<NSObject>::as_ref(&**target);
        ns.as_ref()
    };

    let empty_key = NSString::from_str("");

    // Files first, then folders — same vertical order as the welcome screen
    // and the Antigravity reference. Each section is followed by a separator.
    let (file_recents, folder_recents): (Vec<_>, Vec<_>) = recents
        .iter()
        .enumerate()
        .partition(|(_, entry)| entry.kind == "file");

    let workspace = NSWorkspace::sharedWorkspace();
    let icon_size = NSSize {
        width: 16.0,
        height: 16.0,
    };

    let add_recent_item = |menu: &NSMenu, idx: usize, entry: &OpenTarget| {
        let label = display_label(entry);
        let title = NSString::from_str(&label);
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &title,
                Some(sel!(openRecent:)),
                &empty_key,
            )
        };
        unsafe {
            item.setTag(idx as isize);
            let _: () = msg_send![&*item, setTarget: target_obj];

            // Use Finder's actual icon for the path — folders show the blue
            // folder, .md / .pdf get their own document icons. iconForFile:
            // returns a generic placeholder if the path no longer exists,
            // which still distinguishes file from folder visually.
            let path_ns = NSString::from_str(&entry.path);
            let icon = workspace.iconForFile(&path_ns);
            icon.setSize(icon_size);
            item.setImage(Some(&icon));
        }
        menu.addItem(&item);
    };

    for (idx, entry) in &file_recents {
        add_recent_item(&menu, *idx, entry);
    }
    if !file_recents.is_empty() && !folder_recents.is_empty() {
        menu.addItem(&NSMenuItem::separatorItem(mtm));
    }
    for (idx, entry) in &folder_recents {
        add_recent_item(&menu, *idx, entry);
    }

    if !recents.is_empty() {
        menu.addItem(&NSMenuItem::separatorItem(mtm));
    }
    let new_window_title = NSString::from_str("New Window");
    let new_window_item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            &new_window_title,
            Some(sel!(openNewWindow:)),
            &empty_key,
        )
    };
    unsafe {
        let _: () = msg_send![&*new_window_item, setTarget: target_obj];
    }
    menu.addItem(&new_window_item);

    autorelease_into_raw(menu)
}

/// Surrender a `Retained<NSMenu>` to AppKit per Cocoa's autoreleased-return
/// convention for `applicationDockMenu:`. Without the explicit autorelease
/// the menu would leak each time the user right-clicks the dock — we hold
/// +1 from `NSMenu::new()`, AppKit does its own retain/release, and our
/// extra +1 never balances.
fn autorelease_into_raw(menu: Retained<NSMenu>) -> *mut NSMenu {
    let raw = Retained::into_raw(menu);
    unsafe {
        let _: *mut AnyObject = msg_send![raw as *mut AnyObject, autorelease];
    }
    raw
}

fn display_label(entry: &OpenTarget) -> String {
    let normalized = entry.path.replace('\\', "/");
    let stripped = normalized.trim_end_matches('/');
    if let Some(name) = stripped.rsplit('/').next() {
        if !name.is_empty() {
            return name.to_string();
        }
    }
    entry.path.clone()
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "DoxmindDockTarget"]
    struct DoxmindDockTarget;

    impl DoxmindDockTarget {
        #[unsafe(method(openRecent:))]
        fn open_recent(&self, sender: &NSMenuItem) {
            let tag = sender.tag() as usize;
            let entry = RECENTS
                .get()
                .and_then(|m| m.lock().ok().and_then(|g| g.get(tag).cloned()));
            let Some(entry) = entry else { return };
            if let Some(app) = APP_HANDLE.get() {
                let _ = app.emit("dock://open-recent", entry);
            }
        }

        #[unsafe(method(openNewWindow:))]
        fn open_new_window(&self, _sender: &NSMenuItem) {
            if let Some(app) = APP_HANDLE.get() {
                let _ = app.emit("dock://open-new-window", ());
            }
        }
    }
);

impl DoxmindDockTarget {
    fn new(_mtm: MainThreadMarker) -> Retained<Self> {
        let cls = <Self as ClassType>::class();
        unsafe { msg_send![cls, new] }
    }
}
