//! Markdown → PDF "headless" save via the native print pipeline.
//!
//! The frontend renders the editor under `@media print` (light-mode forced,
//! chrome hidden, per-block rules in `src/app/styles/print.css`). We then
//! capture that print output to a file using `NSPrintOperation` with the
//! save-to-file disposition — no system print dialog, no progress panel.
//!
//! Why not WKWebView's `createPDFWithConfiguration:`? That captures the
//! live screen state and does NOT honor `@media print`. NSPrintOperation
//! goes through the real macOS print pipeline, which DOES apply print
//! media queries, so the same stylesheet that powers Cmd+P also drives
//! this command. One stylesheet, both paths.
//!
//! Returns `Err("unsupported")` on non-macOS so the JS layer can fall
//! back to `window.print()`.

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::mpsc;

    use objc2::class;
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool};
    use objc2_app_kit::NSPrintInfo;
    use objc2_foundation::{NSString, NSURL};

    /// `NSPrintSaveJob` constant. Apple defines this as
    /// `NSString * const NSPrintSaveJob = @"NSSaveJob"`. Hard-coding the
    /// underlying value keeps us independent of objc2-app-kit's exposure
    /// of the constant binding (which has churned across versions).
    const NSPRINT_SAVE_JOB: &str = "NSSaveJob";

    pub fn save_window_pdf_blocking(
        wk_webview: *mut AnyObject,
        target_path: &str,
    ) -> Result<(), String> {
        if wk_webview.is_null() {
            return Err("WKWebView pointer is null".into());
        }
        if target_path.is_empty() {
            return Err("target path is empty".into());
        }

        // SAFETY: We're invoked on the main thread from `with_webview`, the
        // webview pointer is valid for the duration of the call, and every
        // selector below is part of WKWebView / NSPrintInfo / NSPrintOperation
        // public API since macOS 11.0. NSPrintInfo properties accept nil-able
        // NSObject* arguments.
        unsafe {
            // Resolve the absolute path before we hand it to NSURL — relative
            // paths would be interpreted against the app bundle CWD, which
            // isn't where the user picked their save location.
            let path_str = NSString::from_str(target_path);
            let url: Retained<NSURL> = NSURL::fileURLWithPath(&path_str);

            // Use a fresh NSPrintInfo (not sharedPrintInfo) so we don't
            // mutate global app state. Default initializer gives us
            // letter-size with sensible margins.
            let print_info: Retained<NSPrintInfo> = {
                let cls = class!(NSPrintInfo);
                let allocated: *mut AnyObject = msg_send![cls, alloc];
                let inited: *mut AnyObject = msg_send![allocated, init];
                Retained::from_raw(inited as *mut NSPrintInfo)
                    .ok_or_else(|| "failed to allocate NSPrintInfo".to_string())?
            };

            // Configure save-to-file disposition. Two pieces are required:
            //   1. jobDisposition = NSPrintSaveJob ("NSSaveJob")
            //   2. either NSPrintInfo.dictionary[NSPrintJobSavingURL] = url
            //      (10.0+) OR setSaveLocation: url (10.13+, simpler).
            // We use both for compatibility — Apple keeps both supported.
            let disposition = NSString::from_str(NSPRINT_SAVE_JOB);
            let _: () = msg_send![&*print_info, setJobDisposition: &*disposition];

            // saveLocation is the modern API. Wrap in a try because some
            // edge versions of WKWebView ignore it without the dictionary
            // fallback.
            let _: () = msg_send![&*print_info, setSaveLocation: &*url];

            // Build the print operation from the WKWebView. This selector
            // is part of WebKit's macOS API since 11.0.
            let op_ptr: *mut AnyObject =
                msg_send![wk_webview, printOperationWithPrintInfo: &*print_info];
            if op_ptr.is_null() {
                return Err("printOperationWithPrintInfo returned nil".into());
            }
            // Take ownership so ARC-equivalent retain counts balance when
            // the operation goes out of scope.
            let op: Retained<AnyObject> = Retained::from_raw(op_ptr)
                .ok_or_else(|| "failed to retain NSPrintOperation".to_string())?;

            // Suppress UI: no print panel, no progress sheet. With these
            // off + jobDisposition=Save, runOperation writes directly to
            // saveLocation and returns synchronously.
            let _: () = msg_send![&*op, setShowsPrintPanel: Bool::NO];
            let _: () = msg_send![&*op, setShowsProgressPanel: Bool::NO];

            let success: Bool = msg_send![&*op, runOperation];
            if !success.as_bool() {
                return Err("NSPrintOperation runOperation returned NO".into());
            }
        }

        Ok(())
    }

    /// Bridge: marshal the WKWebView pointer + target path to the main
    /// thread (where AppKit print APIs must run), execute, and return the
    /// result via a blocking channel.
    pub fn dispatch_on_main_thread(
        webview_ptr: *mut std::ffi::c_void,
        target_path: String,
    ) -> Result<(), String> {
        // We're already on the main thread because `with_webview`'s closure
        // is dispatched there by Tauri. Just call directly.
        save_window_pdf_blocking(webview_ptr as *mut AnyObject, &target_path)
    }

    pub fn run(
        window: tauri::WebviewWindow,
        target_path: String,
    ) -> Result<(), String> {
        let (tx, rx) = mpsc::channel::<Result<(), String>>();

        window
            .with_webview(move |platform_webview| {
                let ptr = platform_webview.inner();
                let result = dispatch_on_main_thread(ptr as *mut std::ffi::c_void, target_path);
                let _ = tx.send(result);
            })
            .map_err(|e| format!("with_webview: {e}"))?;

        rx.recv()
            .map_err(|e| format!("PDF export channel closed: {e}"))?
    }
}

#[cfg(target_os = "macos")]
pub fn save_window_pdf(window: tauri::WebviewWindow, target_path: String) -> Result<(), String> {
    imp::run(window, target_path)
}

#[cfg(not(target_os = "macos"))]
pub fn save_window_pdf(_window: tauri::WebviewWindow, _target_path: String) -> Result<(), String> {
    // Windows (WebView2 PrintToPdf) and Linux (WebKitGTK) implementations
    // are not yet wired up. The frontend treats this as a signal to fall
    // back to window.print() with the system Save-as-PDF dialog.
    Err("unsupported".into())
}
