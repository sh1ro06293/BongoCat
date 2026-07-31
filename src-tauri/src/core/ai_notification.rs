use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::Mutex,
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_custom_window::ensure_ai_notification_window;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiNotification {
    pub provider: String,
    pub status: String,
    pub title: String,
    pub message: String,
    pub project: Option<String>,
}

#[derive(Default)]
pub struct PendingNotifications(pub Mutex<Vec<AiNotification>>);

fn enqueue(app: &AppHandle, notification: AiNotification) {
    if let Some(state) = app.try_state::<PendingNotifications>() {
        if let Ok(mut pending) = state.0.lock() {
            pending.push(notification);
        }
    }

    ensure_ai_notification_window(app);
}

fn text(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(key).and_then(Value::as_str))
        .map(str::to_owned)
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    let chunks = value.as_bytes().chunks_exact(2);
    if !chunks.remainder().is_empty() {
        return None;
    }

    chunks
        .map(|chunk| {
            std::str::from_utf8(chunk)
                .ok()
                .and_then(|pair| u8::from_str_radix(pair, 16).ok())
        })
        .collect()
}

fn notification_from_value(provider: &str, value: &Value) -> Option<AiNotification> {
    let provider = provider.to_lowercase();
    if !matches!(provider.as_str(), "claude" | "codex") {
        return None;
    }
    let event = text(&value, &["type", "notification_type", "hook_event_name"])
        .unwrap_or_else(|| "notification".into());
    let cwd = text(&value, &["cwd"]);
    let project = cwd.as_deref().and_then(|path| {
        path.trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .map(str::to_owned)
    });

    let (status, default_title) = match event.as_str() {
        "permission_prompt" | "PermissionRequest" | "elicitation_dialog" => {
            ("attention", "承認が必要です")
        }
        "idle_prompt" | "Notification" | "elicitation_response" => {
            ("attention", "入力を待っています")
        }
        "StopFailure" | "error" | "failed" => ("error", "処理に失敗しました"),
        _ => ("complete", "作業が完了しました"),
    };

    let title = text(&value, &["title"]).unwrap_or_else(|| default_title.into());
    let message = text(
        &value,
        &[
            "message",
            "last-assistant-message",
            "last_assistant_message",
            "error_details",
        ],
    )
    .or_else(|| {
        value
            .get("tool_input")
            .and_then(|input| text(input, &["description"]))
    })
    .unwrap_or_else(|| {
        if event == "PermissionRequest" {
            let tool = text(value, &["tool_name"]).unwrap_or_else(|| "Codex".into());

            format!("{tool} is waiting for approval")
        } else if provider == "codex" {
            "Codex のターンが完了しました".into()
        } else {
            "Claude Code の応答が完了しました".into()
        }
    });

    Some(AiNotification {
        provider,
        status: status.into(),
        title,
        message,
        project,
    })
}

fn notification_from_args(args: &[String]) -> Option<AiNotification> {
    let source_index = args.iter().position(|arg| arg == "--ai-notify-source")?;
    let provider = args.get(source_index + 1)?;
    let payload_index = args.iter().position(|arg| arg == "--ai-notify-payload")?;
    let encoded = args.get(payload_index + 1)?;
    let decoded = decode_hex(encoded)?;
    let value: Value = serde_json::from_slice(&decoded).ok()?;

    notification_from_value(provider, &value)
}

pub fn receive(app: &AppHandle, args: &[String], _queue: bool) -> bool {
    let Some(notification) = notification_from_args(args) else {
        return false;
    };

    enqueue(app, notification);

    true
}

#[tauri::command]
pub fn take_pending_ai_notifications(
    state: tauri::State<'_, PendingNotifications>,
) -> Vec<AiNotification> {
    state
        .0
        .lock()
        .map(|mut pending| pending.drain(..).collect())
        .unwrap_or_default()
}

fn relay_response(stream: &mut TcpStream, status: &str) {
    let _ = stream.write_all(
        format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes(),
    );
}

fn handle_relay_connection(app: &AppHandle, mut stream: TcpStream) {
    const MAX_REQUEST_BYTES: usize = 64 * 1024;

    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut request = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 4096];
    let header_end = loop {
        let Ok(read) = stream.read(&mut chunk) else {
            return;
        };
        if read == 0 || request.len() + read > MAX_REQUEST_BYTES {
            relay_response(&mut stream, "413 Payload Too Large");
            return;
        }
        request.extend_from_slice(&chunk[..read]);
        if let Some(index) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
    };

    let Ok(header) = std::str::from_utf8(&request[..header_end]) else {
        relay_response(&mut stream, "400 Bad Request");
        return;
    };
    let mut lines = header.split("\r\n");
    let Some(request_line) = lines.next() else {
        relay_response(&mut stream, "400 Bad Request");
        return;
    };
    let Some(path) = request_line
        .strip_prefix("POST ")
        .and_then(|line| line.split_whitespace().next())
    else {
        relay_response(&mut stream, "405 Method Not Allowed");
        return;
    };
    let Some(provider) = path.strip_prefix("/notify/") else {
        relay_response(&mut stream, "404 Not Found");
        return;
    };
    if !matches!(provider, "claude" | "codex") {
        relay_response(&mut stream, "404 Not Found");
        return;
    }
    let provider = provider.to_owned();

    let content_length = lines
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    if content_length == 0 || header_end + content_length > MAX_REQUEST_BYTES {
        relay_response(&mut stream, "400 Bad Request");
        return;
    }

    while request.len() < header_end + content_length {
        let Ok(read) = stream.read(&mut chunk) else {
            relay_response(&mut stream, "400 Bad Request");
            return;
        };
        if read == 0 || request.len() + read > MAX_REQUEST_BYTES {
            relay_response(&mut stream, "400 Bad Request");
            return;
        }
        request.extend_from_slice(&chunk[..read]);
    }

    let Ok(value) =
        serde_json::from_slice::<Value>(&request[header_end..header_end + content_length])
    else {
        relay_response(&mut stream, "400 Bad Request");
        return;
    };
    let Some(notification) = notification_from_value(&provider, &value) else {
        relay_response(&mut stream, "400 Bad Request");
        return;
    };

    enqueue(app, notification);
    relay_response(&mut stream, "204 No Content");
}

pub fn start_ssh_relay(app: AppHandle) {
    let port = std::env::var("BONGOCAT_RELAY_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(39284);

    thread::spawn(move || {
        let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) else {
            return;
        };
        for stream in listener.incoming().flatten() {
            handle_relay_connection(&app, stream);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(provider: &str, payload: &str) -> Vec<String> {
        let encoded = payload
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect::<String>();

        vec![
            "bongo-cat".into(),
            "--ai-notify-source".into(),
            provider.into(),
            "--ai-notify-payload".into(),
            encoded,
        ]
    }

    #[test]
    fn parses_codex_completion() {
        let notification = notification_from_args(&args(
            "codex",
            r#"{"type":"agent-turn-complete","cwd":"C:\\work\\demo"}"#,
        ))
        .unwrap();

        assert_eq!(notification.provider, "codex");
        assert_eq!(notification.status, "complete");
        assert_eq!(notification.project.as_deref(), Some("demo"));
    }

    #[test]
    fn parses_claude_permission_prompt() {
        let notification = notification_from_args(&args(
            "claude",
            r#"{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"Claude needs permission"}"#,
        ))
        .unwrap();

        assert_eq!(notification.status, "attention");
        assert_eq!(notification.message, "Claude needs permission");
    }

    #[test]
    fn parses_codex_permission_request() {
        let notification = notification_from_args(&args(
            "codex",
            r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"description":"Run the release build"},"cwd":"C:\\work\\demo"}"#,
        ))
        .unwrap();

        assert_eq!(notification.status, "attention");
        assert_eq!(notification.message, "Run the release build");
    }

    #[test]
    fn rejects_invalid_payload() {
        assert!(notification_from_args(&args("codex", "not json")).is_none());
    }

    #[test]
    fn rejects_unknown_provider() {
        assert!(notification_from_args(&args("unknown", "{}")).is_none());
    }
}
