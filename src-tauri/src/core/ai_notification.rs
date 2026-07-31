use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_NAME: &str = "ai-notification";

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

fn notification_from_args(args: &[String]) -> Option<AiNotification> {
    let source_index = args.iter().position(|arg| arg == "--ai-notify-source")?;
    let provider = args.get(source_index + 1)?.to_lowercase();
    let payload_index = args.iter().position(|arg| arg == "--ai-notify-payload")?;
    let encoded = args.get(payload_index + 1)?;
    let decoded = decode_hex(encoded)?;
    let value: Value = serde_json::from_slice(&decoded).ok()?;

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
    .unwrap_or_else(|| {
        if provider == "codex" {
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

pub fn receive(app: &AppHandle, args: &[String], queue: bool) -> bool {
    let Some(notification) = notification_from_args(args) else {
        return false;
    };

    if queue {
        if let Some(state) = app.try_state::<PendingNotifications>() {
            if let Ok(mut pending) = state.0.lock() {
                pending.push(notification);
            }
        }
    } else {
        let _ = app.emit_to("main", EVENT_NAME, &notification);
    }

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
    fn rejects_invalid_payload() {
        assert!(notification_from_args(&args("codex", "not json")).is_none());
    }
}
