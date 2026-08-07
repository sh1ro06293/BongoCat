use tauri::{
    AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    async_runtime::spawn, command,
};

#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

pub static MAIN_WINDOW_LABEL: &str = "main";
pub static PREFERENCE_WINDOW_LABEL: &str = "preference";
pub static AI_NOTIFICATION_WINDOW_LABEL: &str = "ai-notification";

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(target_os = "linux")]
pub use linux::*;

pub fn show_main_window<R: Runtime>(app_handle: &AppHandle<R>) {
    show_existing_window(app_handle, MAIN_WINDOW_LABEL);
}

pub fn show_preference_window<R: Runtime>(app_handle: &AppHandle<R>) {
    if app_handle
        .get_webview_window(PREFERENCE_WINDOW_LABEL)
        .is_some()
    {
        show_existing_window(app_handle, PREFERENCE_WINDOW_LABEL);
        return;
    }

    let app_handle_clone = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if app_handle_clone
            .get_webview_window(PREFERENCE_WINDOW_LABEL)
            .is_some()
        {
            show_existing_window(&app_handle_clone, PREFERENCE_WINDOW_LABEL);
            return;
        }

        let builder = WebviewWindowBuilder::new(
            &app_handle_clone,
            PREFERENCE_WINDOW_LABEL,
            WebviewUrl::App("index.html/#/preference".into()),
        )
        .title("BongoCat")
        .inner_size(800.0, 600.0)
        .min_inner_size(800.0, 600.0)
        .visible(false)
        .skip_taskbar(true);

        #[cfg(target_os = "macos")]
        let builder = builder
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true);

        if let Ok(window) = builder.build() {
            show_built_window(app_handle_clone.clone(), window);
        }
    });
}

pub fn ensure_ai_notification_window<R: Runtime>(app_handle: &AppHandle<R>) {
    if app_handle
        .get_webview_window(AI_NOTIFICATION_WINDOW_LABEL)
        .is_some()
    {
        return;
    }

    let app_handle_clone = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if app_handle_clone
            .get_webview_window(AI_NOTIFICATION_WINDOW_LABEL)
            .is_some()
        {
            return;
        }

        let builder = WebviewWindowBuilder::new(
            &app_handle_clone,
            AI_NOTIFICATION_WINDOW_LABEL,
            WebviewUrl::App("notification.html".into()),
        )
        .title("BongoCat Notification")
        .inner_size(380.0, 124.0)
        .visible(false)
        .focused(false)
        .focusable(false)
        .accept_first_mouse(true)
        .shadow(false)
        .always_on_top(true)
        .transparent(true)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true);

        if let Ok(window) = builder.build() {
            #[cfg(target_os = "macos")]
            configure_overlay_window_collection_behavior(&window);
        }
    });
}

fn show_built_window<R: Runtime>(app_handle: AppHandle<R>, window: WebviewWindow<R>) {
    spawn(async move {
        show_window(app_handle, window).await;
    });
}

fn show_existing_window<R: Runtime>(app_handle: &AppHandle<R>, label: &str) {
    let Some(window) = app_handle.get_webview_window(label) else {
        return;
    };

    show_built_window(app_handle.clone(), window);
}

#[command]
pub async fn show_window_by_label<R: Runtime>(app_handle: AppHandle<R>, label: String) {
    match label.as_str() {
        "main" => show_main_window(&app_handle),
        "preference" => show_preference_window(&app_handle),
        _ => {}
    }
}

#[command]
pub async fn toggle_window_by_label<R: Runtime>(app_handle: AppHandle<R>, label: String) {
    if label != PREFERENCE_WINDOW_LABEL {
        return;
    }

    if let Some(window) = app_handle.get_webview_window(PREFERENCE_WINDOW_LABEL) {
        let _ = window.destroy();
    } else {
        show_preference_window(&app_handle);
    }
}
