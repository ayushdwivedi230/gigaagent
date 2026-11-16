//! Tauri Native Window Invisibility / Screen-Share Exclusion Module
//! Supports:
//! - Windows: SetWindowDisplayAffinity(HWND, WDA_EXCLUDEFROMCAPTURE)
//! - macOS: NSWindow.sharingType = NSWindowSharingNone

use tauri::{AppHandle, Manager, Runtime, Window};

#[cfg(target_os = "windows")]
mod win_native {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WINDOW_DISPLAY_AFFINITY,
    };

    // WDA_EXCLUDEFROMCAPTURE = 0x00000011 (17 decimal)
    // Excludes the window entirely from Windows Graphics Capture, Desktop Duplication,
    // Zoom, Meet, Teams, Discord, OBS, and native screenshotting tools.
    pub const WDA_NONE: WINDOW_DISPLAY_AFFINITY = WINDOW_DISPLAY_AFFINITY(0x00000000);
    pub const WDA_EXCLUDEFROMCAPTURE: WINDOW_DISPLAY_AFFINITY = WINDOW_DISPLAY_AFFINITY(0x00000011);

    pub fn apply_display_affinity(hwnd: isize, enable: bool) -> Result<(), String> {
        let affinity = if enable {
            WDA_EXCLUDEFROMCAPTURE
        } else {
            WDA_NONE
        };

        unsafe {
            let handle = HWND(hwnd as *mut _);
            SetWindowDisplayAffinity(handle, affinity)
                .map_err(|e| format!("SetWindowDisplayAffinity failed with error: {:?}", e))?;
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod mac_native {
    use cocoa::appkit::NSWindow;
    use cocoa::base::id;
    use objc::runtime::NO;
    use objc::{msg_send, sel, sel_impl};

    // NSWindowSharingNone = 0
    // NSWindowSharingReadOnly = 1
    pub const NS_WINDOW_SHARING_NONE: usize = 0;
    pub const NS_WINDOW_SHARING_READ_ONLY: usize = 1;

    pub fn apply_sharing_type(ns_window_ptr: *mut std::ffi::c_void, enable: bool) -> Result<(), String> {
        if ns_window_ptr.is_null() {
            return Err("NSWindow pointer is null".into());
        }

        unsafe {
            let window = ns_window_ptr as id;
            let sharing_type = if enable {
                NS_WINDOW_SHARING_NONE
            } else {
                NS_WINDOW_SHARING_READ_ONLY
            };

            // [window setSharingType:sharing_type]
            let () = msg_send![window, setSharingType: sharing_type];
        }
        Ok(())
    }
}

/// Applies screen-share capture exclusion to a Tauri window.
pub fn set_window_invisibility<R: Runtime>(window: &Window<R>, enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window
            .hwnd()
            .map_err(|e| format!("Failed to retrieve HWND from Tauri window: {:?}", e))?;
        win_native::apply_display_affinity(hwnd.0 as isize, enable)?;
    }

    #[cfg(target_os = "macos")]
    {
        let ns_window = window
            .ns_window()
            .map_err(|e| format!("Failed to retrieve NSWindow from Tauri window: {:?}", e))?;
        mac_native::apply_sharing_type(ns_window.as_ptr(), enable)?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // Unsupported platforms (e.g. Linux X11/Wayland)
        let _ = window;
        let _ = enable;
    }

    Ok(())
}

/// Tauri IPC command: allows the frontend to toggle invisibility on demand.
#[tauri::command]
pub fn toggle_window_invisibility<R: Runtime>(
    window: Window<R>,
    enable: bool,
) -> Result<bool, String> {
    set_window_invisibility(&window, enable)?;
    Ok(enable)
}

/// Tauri window setup hook: applies exclusion upon initialization and registers
/// lifecycle events to reassert exclusion across workspace movements.
pub fn setup_overlay_window<R: Runtime>(window: &Window<R>) -> Result<(), String> {
    // 1. Initial exclusion assertion
    set_window_invisibility(window, true)?;

    // 2. Ensure overlay properties are set
    window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to set always-on-top: {:?}", e))?;

    // 3. Re-assert exclusion on window events (move, focus, scale changes)
    let win_clone = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(true) | tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            let _ = set_window_invisibility(&win_clone, true);
        }
        _ => {}
    });

    Ok(())
}
