const COMMANDS: &[&str] = &[
    "show_window",
    "show_window_by_label",
    "toggle_window_by_label",
    "hide_window",
    "set_always_on_top",
    "set_taskbar_visibility",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
