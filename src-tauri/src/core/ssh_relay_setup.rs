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
const KEY_FILE_NAME: &str = "bongocat_ed25519";

#[derive(Debug)]
struct SshTarget {
    connection: String,
    host: String,
    user: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshRelaySetupResult {
    host_alias: String,
    backup_path: Option<String>,
}

fn valid_target_part(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
}

fn validate_ssh_target(value: &str) -> Result<SshTarget, String> {
    let value = value.trim();

    if value.is_empty() {
        return Err("SSH connection target is required.".into());
    }
    if value.len() > 255 || value.matches('@').count() > 1 {
        return Err("Enter an SSH target such as user@host.example or my-server.".into());
    }

    let (user, host) = match value.split_once('@') {
        Some((user, host)) if valid_target_part(user) && valid_target_part(host) => {
            (Some(user.to_owned()), host.to_owned())
        }
        Some(_) => {
            return Err("Enter an SSH target such as user@host.example or my-server.".into());
        }
        None if valid_target_part(value) => (None, value.to_owned()),
        None => {
            return Err(
                "Use only letters, numbers, periods, underscores, hyphens, and one @ in the SSH target."
                    .into(),
            );
        }
    };

    Ok(SshTarget {
        connection: value.into(),
        host,
        user,
    })
}

fn ssh_directory() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let home = env::var_os("USERPROFILE");

    #[cfg(not(target_os = "windows"))]
    let home = env::var_os("HOME");

    home.map(PathBuf::from)
        .map(|path| path.join(".ssh"))
        .ok_or_else(|| "Could not find the user home directory.".into())
}

fn output_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();

    if stderr.is_empty() {
        format!("process exited with {}", output.status)
    } else {
        stderr
    }
}

fn run_with_input(
    command: &mut Command,
    input: Option<&str>,
    start_error: &str,
) -> Result<(), String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    if input.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("{start_error}: {error}"))?;

    if let Some(input) = input {
        child
            .stdin
            .take()
            .ok_or_else(|| "Could not open process input.".to_string())?
            .write_all(input.as_bytes())
            .map_err(|error| format!("Could not send setup data: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not wait for the process: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(output_error(&output))
    }
}

fn ensure_dedicated_key(ssh_directory: &Path) -> Result<(PathBuf, String), String> {
    fs::create_dir_all(ssh_directory)
        .map_err(|error| format!("Could not create ~/.ssh: {error}"))?;

    let private_key = ssh_directory.join(KEY_FILE_NAME);
    let public_key = ssh_directory.join(format!("{KEY_FILE_NAME}.pub"));

    if public_key.exists() && !private_key.exists() {
        return Err("The BongoCat public key exists, but its private key is missing.".into());
    }

    if !private_key.exists() {
        let output = Command::new("ssh-keygen")
            .args([
                "-q",
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                "BongoCat SSH relay",
                "-f",
            ])
            .arg(&private_key)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("Could not start ssh-keygen: {error}"))?;

        if !output.status.success() {
            return Err(format!(
                "Could not generate the BongoCat SSH key: {}",
                output_error(&output)
            ));
        }
    }

    if !public_key.exists() {
        let output = Command::new("ssh-keygen")
            .args(["-y", "-f"])
            .arg(&private_key)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("Could not start ssh-keygen: {error}"))?;

        if !output.status.success() {
            return Err(format!(
                "Could not recreate the BongoCat public key: {}",
                output_error(&output)
            ));
        }

        fs::write(
            &public_key,
            format!("{}\n", String::from_utf8_lossy(&output.stdout).trim()),
        )
        .map_err(|error| format!("Could not write the BongoCat public key: {error}"))?;
    }

    let public_key_text = fs::read_to_string(&public_key)
        .map_err(|error| format!("Could not read the BongoCat public key: {error}"))?;

    Ok((private_key, public_key_text.trim().to_owned()))
}

fn base_ssh_command(target: &SshTarget, private_key: &Path) -> Command {
    let mut command = Command::new("ssh");
    command
        .arg("-i")
        .arg(private_key)
        .args([
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ConnectTimeout=10",
        ])
        .arg(&target.connection);

    command
}

fn run_ssh_with_key(
    target: &SshTarget,
    private_key: &Path,
    remote_command: &str,
    input: Option<&str>,
) -> Result<(), String> {
    let mut command = base_ssh_command(target, private_key);
    command.args(["-o", "BatchMode=yes"]).arg(remote_command);

    run_with_input(&mut command, input, "Could not start ssh")
}

fn install_public_key_with_password(
    target: &SshTarget,
    private_key: &Path,
    public_key: &str,
    password: &str,
) -> Result<(), String> {
    let askpass = env::current_exe()
        .map_err(|error| format!("Could not find the BongoCat executable: {error}"))?;
    let mut command = base_ssh_command(target, private_key);
    command
        .args([
            "-o",
            "BatchMode=no",
            "-o",
            "PubkeyAuthentication=no",
            "-o",
            "PreferredAuthentications=keyboard-interactive,password",
            "-o",
            "NumberOfPasswordPrompts=1",
        ])
        .arg(
            "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; IFS= read -r key; grep -qxF \"$key\" ~/.ssh/authorized_keys || printf '%s\\n' \"$key\" >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys",
        )
        .env("SSH_ASKPASS", askpass)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("DISPLAY", "bongocat:0")
        .env("BONGOCAT_SSH_ASKPASS_MODE", "1")
        .env("BONGOCAT_SSH_PASSWORD", password);
    let input = format!("{public_key}\n");

    run_with_input(
        &mut command,
        Some(&input),
        "Could not start password authentication",
    )
}

fn relay_block(target: &SshTarget, line_ending: &str) -> String {
    let marker_start = format!("# >>> BongoCat relay: {} >>>", target.host);
    let marker_end = format!("# <<< BongoCat relay: {} <<<", target.host);
    let user = target
        .user
        .as_deref()
        .map(|user| format!("  User {user}{line_ending}"))
        .unwrap_or_default();

    format!(
        "{marker_start}{line_ending}Host {host}{line_ending}{user}  IdentityFile ~/.ssh/{KEY_FILE_NAME}{line_ending}  IdentitiesOnly yes{line_ending}  RemoteForward 39284 127.0.0.1:39284{line_ending}  ExitOnForwardFailure yes{line_ending}{marker_end}{line_ending}",
        host = target.host,
    )
}

fn upsert_relay_config(config_path: &Path, target: &SshTarget) -> Result<Option<PathBuf>, String> {
    let parent = config_path
        .parent()
        .ok_or_else(|| "Could not find the SSH config directory.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Could not create ~/.ssh: {error}"))?;

    let original = match fs::read_to_string(config_path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Could not read the SSH config: {error}")),
    };
    let line_ending = if original.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let block = relay_block(target, line_ending);
    let marker_start = format!("# >>> BongoCat relay: {} >>>", target.host);
    let marker_end = format!("# <<< BongoCat relay: {} <<<", target.host);

    let updated = if let Some(start) = original.find(&marker_start) {
        let end = original[start..]
            .find(&marker_end)
            .map(|offset| start + offset + marker_end.len())
            .ok_or_else(|| "The existing BongoCat SSH config block is incomplete.".to_string())?;
        let mut after = end;

        if original[after..].starts_with("\r\n") {
            after += 2;
        } else if original[after..].starts_with('\n') {
            after += 1;
        }

        format!("{}{}{}", &original[..start], block, &original[after..])
    } else {
        let separator = if original.is_empty() || original.ends_with(['\r', '\n']) {
            ""
        } else {
            line_ending
        };

        format!("{original}{separator}{block}")
    };

    if updated == original {
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

    fs::write(config_path, updated)
        .map_err(|error| format!("Could not update the SSH config: {error}"))?;

    Ok(backup_path)
}

fn setup(connection_target: &str, password: Option<&str>) -> Result<SshRelaySetupResult, String> {
    let target = validate_ssh_target(connection_target)?;
    let ssh_directory = ssh_directory()?;
    let config_path = ssh_directory.join("config");
    let (private_key, public_key) = ensure_dedicated_key(&ssh_directory)?;

    if run_ssh_with_key(&target, &private_key, "true", None).is_err() {
        let password = password
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Enter the SSH password for the first setup.".to_string())?;

        install_public_key_with_password(&target, &private_key, &public_key, password)
            .map_err(|error| format!("Could not register the BongoCat SSH key: {error}"))?;
        run_ssh_with_key(&target, &private_key, "true", None)
            .map_err(|error| format!("The generated SSH key was not accepted: {error}"))?;
    }

    run_ssh_with_key(
        &target,
        &private_key,
        "command -v python3 >/dev/null 2>&1",
        None,
    )
    .map_err(|error| format!("python3 is unavailable on the SSH host: {error}"))?;
    run_ssh_with_key(&target, &private_key, "mkdir -p ~/.local/bin", None)
        .map_err(|error| format!("Could not create the remote directory: {error}"))?;
    run_ssh_with_key(
        &target,
        &private_key,
        "cat > ~/.local/bin/bongocat-notify",
        Some(NOTIFIER_SCRIPT),
    )
    .map_err(|error| format!("Could not copy the notification script: {error}"))?;
    run_ssh_with_key(
        &target,
        &private_key,
        "cat > ~/.local/bin/install-bongocat-notify",
        Some(INSTALLER_SCRIPT),
    )
    .map_err(|error| format!("Could not copy the installer script: {error}"))?;
    run_ssh_with_key(
        &target,
        &private_key,
        "chmod +x ~/.local/bin/bongocat-notify ~/.local/bin/install-bongocat-notify && ~/.local/bin/install-bongocat-notify",
        None,
    )
    .map_err(|error| format!("The remote hook installation failed: {error}"))?;

    let backup_path = upsert_relay_config(&config_path, &target)?;

    Ok(SshRelaySetupResult {
        host_alias: target.connection,
        backup_path: backup_path.map(|path| path.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub async fn setup_ssh_relay(
    host_alias: String,
    password: Option<String>,
) -> Result<SshRelaySetupResult, String> {
    spawn_blocking(move || setup(&host_alias, password.as_deref()))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_ssh_targets() {
        let target = validate_ssh_target(" user@host.example ").unwrap();
        assert_eq!(target.connection, "user@host.example");
        assert_eq!(target.user.as_deref(), Some("user"));
        assert_eq!(target.host, "host.example");
        assert!(validate_ssh_target("user@@example.com").is_err());
        assert!(validate_ssh_target("-V").is_err());
        assert!(validate_ssh_target("server; reboot").is_err());
        assert!(validate_ssh_target("").is_err());
    }

    #[test]
    fn upserts_relay_config_and_creates_backup() {
        let directory = env::temp_dir().join(format!(
            "bongocat-ssh-relay-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let config_path = directory.join("config");
        let target = validate_ssh_target("user@example").unwrap();
        fs::create_dir_all(&directory).unwrap();
        fs::write(&config_path, "Host example\n  HostName example.com\n").unwrap();

        let backup = upsert_relay_config(&config_path, &target).unwrap();
        let first = fs::read_to_string(&config_path).unwrap();
        let second_backup = upsert_relay_config(&config_path, &target).unwrap();
        let second = fs::read_to_string(&config_path).unwrap();

        assert!(backup.is_some_and(|path| path.exists()));
        assert!(first.contains("User user"));
        assert!(first.contains("IdentityFile ~/.ssh/bongocat_ed25519"));
        assert!(first.contains("RemoteForward 39284 127.0.0.1:39284"));
        assert_eq!(first, second);
        assert!(second_backup.is_none());

        assert!(directory.starts_with(env::temp_dir()));
        fs::remove_dir_all(directory).unwrap();
    }
}
