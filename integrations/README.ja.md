# Claude Code / Codex 通知連携

BongoCat を起動した状態で、AI エージェントの完了・入力待ち・失敗を猫の吹き出しとして表示します。

## Windows

### Codex CLI

`~/.codex/config.toml` に次を追加します。パスはこのリポジトリの実際の場所へ置き換えてください。

```toml
notify = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "D:\\hal\\BongoCat\\integrations\\bongocat-notify.ps1", "-Provider", "codex"]
```

Codex が末尾に追加する JSON 引数をスクリプトが BongoCat へ転送します。Codex CLI/TUI の `agent-turn-complete` に対応します。

承認待ちも受け取るには、`~/.codex/hooks.json` の `hooks` に次を追加します。既存の hooks がある場合は上書きせず、`PermissionRequest` の配列へ要素を追加してください。

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"D:\\hal\\BongoCat\\integrations\\bongocat-notify.ps1\" -Provider codex",
            "timeout": 3,
            "statusMessage": "Notifying BongoCat"
          }
        ]
      }
    ]
  }
}
```

Codex を再起動し、最初の一度だけ `/hooks` を開いてこのコマンドを許可します。この確認は Codex の安全機能なので省略できません。

### Claude Code

`~/.claude/settings.json` の `hooks` に次を追加します。既存の hooks がある場合は上書きせず、各配列へ要素を追加してください。

```json
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"D:\\hal\\BongoCat\\integrations\\bongocat-notify.ps1\" -Provider claude"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"D:\\hal\\BongoCat\\integrations\\bongocat-notify.ps1\" -Provider claude"
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"D:\\hal\\BongoCat\\integrations\\bongocat-notify.ps1\" -Provider claude"
          }
        ]
      }
    ]
  }
}
```

インストール先が自動検出されない場合は、環境変数 `BONGOCAT_PATH` に `BongoCat.exe` の絶対パスを設定します。

## macOS

最初に連携スクリプトへ実行権限を付けます。

```sh
chmod +x /path/to/BongoCat/integrations/bongocat-notify.sh
```

### Codex CLI

`~/.codex/config.toml` に追加します。

```toml
notify = ["/bin/sh", "/path/to/BongoCat/integrations/bongocat-notify.sh", "codex"]
```

承認待ちも受け取るには、`~/.codex/hooks.json` の `hooks` に追加します。

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/bin/sh /path/to/BongoCat/integrations/bongocat-notify.sh codex",
            "timeout": 3,
            "statusMessage": "Notifying BongoCat"
          }
        ]
      }
    ]
  }
}
```

Codex を再起動し、最初の一度だけ `/hooks` を開いてこのコマンドを許可します。

### Claude Code

`~/.claude/settings.json` の `hooks` に追加します。

```json
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/bin/sh /path/to/BongoCat/integrations/bongocat-notify.sh claude"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/bin/sh /path/to/BongoCat/integrations/bongocat-notify.sh claude"
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/bin/sh /path/to/BongoCat/integrations/bongocat-notify.sh claude"
          }
        ]
      }
    ]
  }
}
```

スクリプトは `/Applications/BongoCat.app` と `~/Applications/BongoCat.app` を自動検出します。別の場所へ置く場合は、環境変数 `BONGOCAT_PATH` に `.app/Contents/MacOS/` 内の実行ファイルを指定してください。

## SSH先のCodex / Claude Code

BongoCatは `127.0.0.1:39284` だけでHTTP通知を受け付けます。外部インターフェイスでは待ち受けません。SSHのリバースポートフォワードを使うと、SSH先の同じポートがローカルのBongoCatへ暗号化転送されます。

### BongoCatの設定画面から自動設定

WindowsとmacOSでは、猫を右クリックして設定を開き、「一般」→「AIエージェント連携」→「SSH通知リレー」から設定できます。

設定画面へ `user@host.example` のように `ユーザー名@ホスト名` と、初回だけSSHログインパスワードを入力して「設定する」を押してください。BongoCatは `~/.ssh/bongocat_ed25519` に専用鍵を作ってSSH先へ登録し、ローカルのSSH設定をバックアップしてリバースフォワードを追加します。さらにSSH先のCodex・Claude Code通知フックを、既存設定を残したまま追加します。入力したパスワードは保存しません。2回目以降はパスワードを空欄にできます。SSH先には `python3` が必要です。

設定後はSSHへ接続し直し、SSH先のCodex・Claude Codeを再起動してください。

### 手動設定

ローカル側の `~/.ssh/config` で、対象ホストへ次を追加します。

```sshconfig
Host your-server
  HostName example.com
  User your-user
  RemoteForward 39284 127.0.0.1:39284
  ExitOnForwardFailure yes
```

SSH先へ `bongocat-notify.sh` をコピーして実行権限を付け、SSH先のCodexまたはClaude Codeからそのスクリプトを呼びます。

```sh
mkdir -p ~/.local/bin
chmod +x ~/.local/bin/bongocat-notify
```

SSH先の `~/.codex/config.toml` には絶対パスで追加します。

```toml
notify = ["/bin/sh", "/home/your-user/.local/bin/bongocat-notify", "codex"]
```

承認待ちはSSH先の `~/.codex/hooks.json` にも `PermissionRequest` フックを追加します。Windowsの自動設定スクリプトを使う場合は自動で追加されます。設定後、SSH先のCodexを再起動し、最初の一度だけ `/hooks` で許可してください。

接続中に次のコマンドで中継だけをテストできます。

```sh
printf '%s' '{"type":"agent-turn-complete","cwd":"/tmp/ssh-test"}' |
  ~/.local/bin/bongocat-notify codex
```

SSHサーバー側でTCPフォワーディングが禁止されている場合は、サーバー管理者による `AllowTcpForwarding yes` の設定が必要です。

### WindowsからSSH先を自動設定

接続先が `ssh my-server` で利用できる場合、Windows側で次を一度実行します。

```powershell
& 'D:\hal\BongoCat\integrations\setup-ssh-relay.ps1' -HostAlias my-server
```

このスクリプトは次を行います。

- Windowsの `~/.ssh/config` をバックアップ
- 対象ホストだけに `RemoteForward` を追加
- SSH先の `~/.local/bin` に通知スクリプトを配置
- SSH先のCodex設定をバックアップして、完了通知と承認待ちフックを追加
- SSH先にClaude Code設定があれば、既存hooksを残して通知hooksを追加

設定後は一度SSH接続を切り、通常どおり再接続してください。
