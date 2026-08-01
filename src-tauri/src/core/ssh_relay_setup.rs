use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::async_runtime::spawn_blocking;

const NOTIFIER_SCRIPT: &str = include_str!("../../../integrations/bongocat-notify.sh");
const INSTALLER_SCRIPT: &str = include_str!("../../../integrations/install-remote.sh");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshRelaySetupResult {
    host_alias: String,
    backup_path: Option<String>,
}

fn validate_host_alias(value: &str) -> Result<String, String> {
    let value = value.trim();

    if value.is_empty() {
        return Err("SSH host alias is required.".into());
    }
    if value.starts_with('-')
        || value.len() > 255
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
    {
        return Err(
            "Use only letters, numbers, periods, underscores, and hyphens in the SSH host alias."
                .into(),
        );
    }

    Ok(value.into())
}

fn ssh_config_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let home = env::var_os("USERPROFILE");

    #[cfg(not(target_os = "windows"))]
    let home = env::var_os("HOME");

    home.map(PathBuf::from)
        .map(|path| path.join(".ssh").join("config"))
        .ok_or_else(|| "Could not find the user home directory.".into())
}

fn append_relay_config(config_path: &Path, host_alias: &str) -> Result<Option<PathBuf>, String> {
    let parent = config_path
        .parent()
        .ok_or_else(|| "Could not find the SSH config directory.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Could not create ~/.ssh: {error}"))?;

    let original = match fs::read_to_string(config_path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Could not read the SSH config: {error}")),
    };
    let marker_start = format!("# >>> BongoCat relay: {host_alias} >>>");

    if original.contains(&marker_start) {
        return Ok(None);
    }

    let backup_path = if config_path.exists() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs();
        let path = config_path.with_file_name(format!("config.bak-{timestamp}"));
        fs::copy(config_path, &path)
            .map_err(|error| format!("Could not back up the SSH config: {error}"))?;

        Some(path)
    } else {
        None
    };

    let line_ending = if original.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let separator = if original.is_empty() || original.ends_with(['\r', '\n']) {
        ""
    } else {
        line_ending
    };
    let relay_block = format!(
        "{separator}{marker_start}{line_ending}Host {host_alias}{line_ending}  RemoteForward 39284 127.0.0.1:39284{line_ending}  ExitOnForwardFailure yes{line_ending}# <<< BongoCat relay: {host_alias} <<<{line_ending}"
    );

    fs::write(config_path, format!("{original}{relay_block}"))
        .map_err(|error| format!("Could not update the SSH config: {error}"))?;

    Ok(backup_path)
}

fn run_ssh(host_alias: &str, remote_command: &str, input: Option<&str>) -> Result<(), String> {
    let mut command = Command::new("ssh");
    command
        .args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"])
        .arg(host_alias)
        .arg(remote_command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if input.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start ssh: {error}"))?;

    if let Some(input) = input {
        child
            .stdin
            .take()
            .ok_or_else(|| "Could not open ssh input.".to_string())?
            .write_all(input.as_bytes())
            .map_err(|error| format!("Could not send the setup script: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not wait for ssh: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    let detail = if stderr.is_empty() {
        format!("ssh exited with {}", output.status)
    } else {
        stderr
    };

    Err(detail)
}

fn setup(host_alias: &str) -> Result<SshRelaySetupResult, String> {
    let host_alias = validate_host_alias(host_alias)?;

    run_ssh(&host_alias, "command -v python3 >/dev/null 2>&1", None)
        .map_err(|error| format!("SSH connection failed or python3 is unavailable: {error}"))?;
    run_ssh(&host_alias, "mkdir -p ~/.local/bin", None)
        .map_err(|error| format!("Could not create the remote directory: {error}"))?;
    run_ssh(
        &host_alias,
        "cat > ~/.local/bin/bongocat-notify",
        Some(NOTIFIER_SCRIPT),
    )
    .map_err(|error| format!("Could not copy the notification script: {error}"))?;
    run_ssh(
        &host_alias,
        "cat > ~/.local/bin/install-bongocat-notify",
        Some(INSTALLER_SCRIPT),
    )
    .map_err(|error| format!("Could not copy the installer script: {error}"))?;
    run_ssh(
        &host_alias,
        "chmod +x ~/.local/bin/bongocat-notify ~/.local/bin/install-bongocat-notify && ~/.local/bin/install-bongocat-notify",
        None,
    )
    .map_err(|error| format!("The remote hook installation failed: {error}"))?;

    let config_path = ssh_config_path()?;
    let backup_path = append_relay_config(&config_path, &host_alias)?;

    Ok(SshRelaySetupResult {
        host_alias,
        backup_path: backup_path.map(|path| path.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub async fn setup_ssh_relay(host_alias: String) -> Result<SshRelaySetupResult, String> {
    spawn_blocking(move || setup(&host_alias))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_ssh_aliases() {
        assert_eq!(validate_host_alias(" my-server_1 ").unwrap(), "my-server_1");
        assert!(validate_host_alias("user@example.com").is_err());
        assert!(validate_host_alias("-V").is_err());
        assert!(validate_host_alias("server; reboot").is_err());
        assert!(validate_host_alias("").is_err());
    }

    #[test]
    fn appends_relay_config_once_and_creates_backup() {
        let directory = env::temp_dir().join(format!(
            "bongocat-ssh-relay-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let config_path = directory.join("config");
        fs::create_dir_all(&directory).unwrap();
        fs::write(&config_path, "Host example\n  HostName example.com\n").unwrap();

        let backup = append_relay_config(&config_path, "example").unwrap();
        let first = fs::read_to_string(&config_path).unwrap();
        let second_backup = append_relay_config(&config_path, "example").unwrap();
        let second = fs::read_to_string(&config_path).unwrap();

        assert!(backup.is_some_and(|path| path.exists()));
        assert!(first.contains("RemoteForward 39284 127.0.0.1:39284"));
        assert_eq!(first, second);
        assert!(second_backup.is_none());

        assert!(directory.starts_with(env::temp_dir()));
        fs::remove_dir_all(directory).unwrap();
    }
}
