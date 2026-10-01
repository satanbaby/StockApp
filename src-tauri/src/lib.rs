use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, Wry,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const MAIN_WINDOW: &str = "main";
/// Gap between the panel and the taskbar / screen edge, in physical pixels.
const PANEL_MARGIN: i32 = 12;
/// A tray click this soon after the panel auto-hid on blur means "close", not "reopen".
const REOPEN_GUARD: Duration = Duration::from_millis(300);

/// Keeps the tray "釘住面板" check item in sync with the window state.
struct TrayState {
    pinned_item: CheckMenuItem<Wry>,
}

#[derive(Default)]
struct PanelState {
    /// Pinned panels stay on top and do not hide when they lose focus.
    pinned: bool,
    last_hidden_at: Option<Instant>,
    /// Last tray click position, used to anchor the panel when opened from the menu.
    last_anchor: Option<PhysicalPosition<f64>>,
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW)
}

/// Place the panel above the taskbar, horizontally centred on the tray icon
/// and clamped inside the monitor's work area.
fn position_panel(app: &AppHandle, window: &WebviewWindow) {
    let anchor = app.state::<Mutex<PanelState>>().lock().unwrap().last_anchor;
    let monitor = match anchor {
        Some(p) => app.monitor_from_point(p.x, p.y).ok().flatten(),
        None => None,
    }
    .or_else(|| app.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, window.outer_size()) else { return };

    let area = monitor.work_area();
    let (w, h) = (size.width as i32, size.height as i32);
    let left = area.position.x + PANEL_MARGIN;
    let right = area.position.x + area.size.width as i32 - PANEL_MARGIN - w;
    let x = match anchor {
        Some(p) => (p.x as i32 - w / 2).clamp(left, right.max(left)),
        None => right,
    };
    let y = area.position.y + area.size.height as i32 - PANEL_MARGIN - h;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn show_panel_impl(app: &AppHandle) {
    let Some(window) = main_window(app) else { return };
    position_panel(app, &window);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("panel-shown", ());
}

fn hide_panel(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        let _ = window.hide();
    }
    app.state::<Mutex<PanelState>>().lock().unwrap().last_hidden_at = Some(Instant::now());
}

fn toggle_panel(app: &AppHandle) {
    let Some(window) = main_window(app) else { return };
    if window.is_visible().unwrap_or(false) {
        hide_panel(app);
        return;
    }
    // Clicking the tray icon steals focus first, which already auto-hid the panel.
    let just_hidden = app
        .state::<Mutex<PanelState>>()
        .lock()
        .unwrap()
        .last_hidden_at
        .is_some_and(|t| t.elapsed() < REOPEN_GUARD);
    if !just_hidden {
        show_panel_impl(app);
    }
}

fn apply_pinned(app: &AppHandle, on: bool) {
    app.state::<Mutex<PanelState>>().lock().unwrap().pinned = on;
    if let Some(window) = main_window(app) {
        let _ = window.set_always_on_top(on);
    }
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.pinned_item.set_checked(on);
    }
    let _ = app.emit("always-on-top-changed", on);
}

#[tauri::command]
fn set_always_on_top(app: AppHandle, on: bool) {
    apply_pinned(&app, on);
}

#[tauri::command]
fn show_panel(app: AppHandle) {
    show_panel_impl(&app);
}

#[tauri::command]
fn hide_panel_cmd(app: AppHandle) {
    hide_panel(&app);
}

/// Replace the "show panel" hotkey; `None` disables it.
#[tauri::command]
fn set_global_shortcut(app: AppHandle, accelerator: Option<String>) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    match accelerator.as_deref().map(str::trim) {
        Some(acc) if !acc.is_empty() => gs.register(acc).map_err(|e| e.to_string()),
        _ => Ok(()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_panel(app);
                    }
                })
                .build(),
        )
        .manage(Mutex::new(PanelState::default()))
        .invoke_handler(tauri::generate_handler![set_always_on_top, show_panel, hide_panel_cmd, set_global_shortcut])
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "顯示 / 隱藏", true, None::<&str>)?;
            let pinned_item = CheckMenuItem::with_id(app, "pin", "📌 釘住面板", true, false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "離開程式", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&toggle, &pinned_item, &separator, &quit])?;

            app.manage(TrayState { pinned_item: pinned_item.clone() });

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("即時台股")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_panel(app),
                    "pin" => {
                        let on = app
                            .try_state::<TrayState>()
                            .and_then(|s| s.pinned_item.is_checked().ok())
                            .unwrap_or(false);
                        apply_pinned(app, on);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        position,
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        app.state::<Mutex<PanelState>>().lock().unwrap().last_anchor = Some(position);
                        toggle_panel(app);
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the window only hides it; the app keeps living in the tray.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                hide_panel(window.app_handle());
            }
            // Behave like a flyout: clicking anywhere else dismisses it.
            tauri::WindowEvent::Focused(false) => {
                let app = window.app_handle();
                let pinned = app.state::<Mutex<PanelState>>().lock().unwrap().pinned;
                if !pinned && window.is_visible().unwrap_or(false) {
                    hide_panel(app);
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
