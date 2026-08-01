# BongoCat セットアップ（Windows / macOS）

このフォークで追加したClaude Code・Codex通知対応版の導入手順です。

対応環境は次のとおりです。

- Windows 10/11（x64）
- Apple Silicon搭載Mac（M1・M2・M3・M4など）

Intel Mac版は生成しません。

## Windows

### 1. インストール

生成済みの `BongoCat_1.1.0_x64-setup.exe` を実行します。このPCでローカルビルドした場合の保存先は次の場所です。

```text
target\release\bundle\nsis\BongoCat_1.1.0_x64-setup.exe
```

画面の指示に従ってインストールすると、通常は次の場所へ配置されます。

```text
C:\Program Files\BongoCat\bongo-cat.exe
```

### 2. 初回起動

BongoCatを起動すると猫が表示されます。猫を右クリックするか、タスクトレイのBongoCatアイコンを開くと設定画面へ移動できます。

設定画面の「一般」→「言語」から `日本語` を選べます。WindowsとmacOSの両方で同じです。

通常は管理者として起動する必要はありません。管理者権限で動くゲームのキー入力などを取得できない場合だけ、BongoCatを右クリックして「管理者として実行」を選んでください。

### 3. FPS

このフォークでは既定値を30 FPSにしています。変更する場合は、猫を右クリックして設定を開き、猫の設定にある最大FPSを変更します。

## macOS（Apple Silicon）

### 1. DMGを入手

1. GitHubの [Build macOS (Apple Silicon)](https://github.com/sh1ro06293/BongoCat/actions/workflows/build-macos.yml) を開く
2. 成功している最新の実行結果を開く
3. 画面下部のArtifactsから `BongoCat-macOS-Apple-Silicon` をダウンロード
4. ダウンロードしたZIPを展開してDMGを開く

Artifactは30日で期限切れになります。期限切れの場合は、このブランチへpushして再生成します。ワークフローがmasterへ入った後はActions画面の `Run workflow` からも生成できます。

### 2. インストール

DMG内の `BongoCat.app` を `Applications` フォルダへドラッグします。

このDMGは自分用の署名なしビルドです。最初の起動がmacOSに止められた場合は次の手順で開きます。

1. 一度BongoCatを開いて警告を表示する
2. 「システム設定」→「プライバシーとセキュリティ」を開く
3. BongoCatについて「このまま開く」を選ぶ

自分で生成したArtifactであることを確認してから許可してください。

### 3. 入力監視を許可

猫を右クリックするか、メニューバーのBongoCatアイコンから設定を開きます。「一般設定」にある入力監視を許可してください。

手動で設定する場合は次のとおりです。

1. 「システム設定」→「プライバシーとセキュリティ」→「入力監視」を開く
2. `BongoCat` を追加して有効にする
3. BongoCatを終了して起動し直す

### 4. Mac本体でビルドする場合

Taskを一度だけインストールします。

```sh
brew install go-task/tap/go-task
```

このリポジトリ内で次を実行すると、Apple Silicon向けDMGを生成できます。

```sh
task mac:build
```

詳しくは [BUILD_MACOS.ja.md](BUILD_MACOS.ja.md) を参照してください。

## Codex通知

BongoCatを起動した状態で設定します。完了通知に加えて、承認待ちは `PermissionRequest` フックで通知します。

- Windows: `~/.codex/config.toml` と `~/.codex/hooks.json` を設定
- macOS: 同じ2ファイルから `integrations/bongocat-notify.sh` を実行

設定後にCodexを再起動し、最初の一度だけ `/hooks` を開いてBongoCat通知コマンドを許可してください。

## Claude Code通知

BongoCatを起動した状態で `~/.claude/settings.json` に次のフックを追加します。

- `Notification`: 承認・入力待ち
- `Stop`: 完了
- `StopFailure`: APIエラーなどの失敗

設定後にClaude Codeを起動し直してください。

CodexとClaude Codeの設定例は、Windows/macOSとも [integrations/README.ja.md](integrations/README.ja.md) に記載しています。

## SSH先で動かす場合

SSHのリバースポートフォワードを使うと、SSH先のCodex・Claude CodeからローカルPCのBongoCatへ通知できます。

WindowsとmacOSのどちらも、BongoCatの設定画面から自動設定できます。

1. 先にターミナルで `ssh my-server` を実行し、鍵認証で接続できることを確認する
2. 猫を右クリックして設定を開く
3. 「一般」→「AIエージェント連携」→「SSH通知リレー」を開く
4. `my-server` の部分を入力して「設定する」を押す
5. 完了後にSSHへ接続し直し、SSH先のCodex・Claude Codeを再起動する

設定を実行すると、変更前の `~/.ssh/config` は `config.bak-<timestamp>` という名前でバックアップされます。SSH先には `python3` が必要です。パスワード入力には対応していないため、SSH鍵を使用してください。

Windowsで従来のスクリプトから設定する場合は次を実行します。`my-server` は `ssh my-server` で接続できるホスト名へ置き換えてください。

```powershell
& 'D:\hal\BongoCat\integrations\setup-ssh-relay.ps1' -HostAlias my-server
```

設定後はSSH接続とSSH先のCodex・Claude Codeを起動し直します。詳しい仕組みと手動設定は [integrations/README.ja.md](integrations/README.ja.md#ssh先のcodex--claude-code) を参照してください。

## 通知が来ない場合

次を順番に確認します。

1. BongoCatが起動しているか
2. CodexまたはClaude Codeを設定後に起動し直したか
3. Codexで `/hooks` の初回許可を行ったか
4. 設定内の通知スクリプトが実在する絶対パスになっているか
5. SSH利用時は `RemoteForward 39284 127.0.0.1:39284` が有効か

Codexの通常の `notify` は完了時に使用し、承認待ちは別の `PermissionRequest` フックで受け取ります。どちらか一方しか設定されていない場合は、通知が来る場面も片方だけになります。
