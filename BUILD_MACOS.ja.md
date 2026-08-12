# macOS（Apple Silicon）ビルド

M1・M2・M3・M4など、Apple Silicon搭載Mac向けのDMGを生成します。Intel Mac版は生成しません。

DMGのインストール、初回起動、入力監視、Claude Code / Codex通知の設定は [SETUP.ja.md](SETUP.ja.md) を参照してください。

## GitHubで生成する

`feat/ai-agent-notifications` ブランチへpushすると、GitHub Actionsの `Build macOS (Apple Silicon)` が自動実行されます。

1. GitHubで `Actions` を開く
2. `Build macOS (Apple Silicon)` の完了を待つ
3. 実行結果の `Artifacts` から `BongoCat-macOS-Apple-Silicon` をダウンロード
4. ZIP内のDMGをMacで開く

Artifactの保存期間は30日です。Gitへ大きなDMGを直接コミットしないため、リポジトリは重くなりません。

## Mac本体で生成する

初回だけTaskをインストールします。

```sh
brew install go-task/tap/go-task
```

リポジトリ内で次を実行します。

```sh
task mac:build
```

生成先を確認するには次を実行します。

```sh
task mac:output
```

すでに `/Applications/BongoCat.app` をインストールしているMacでは、最新ソースをpullした後に次の1コマンドでビルドと更新を行えます。

```sh
task mac:update
```

DMGを作らず `.app` のみをビルドします。その後、実行中のBongoCatを終了し、既存版を `/private/tmp/BongoCat-before-update-<日時>.app` へ退避してから、新しいアプリを `/Applications` へインストールして起動します。Gitのpullはこのタスクに含まれません。

## 署名について

この手順で生成するDMGはApple Developer署名と公証を行いません。そのため、初回起動時にmacOSの警告が表示される場合があります。一般配布する場合はApple Developer IDによる署名と公証を追加してください。
