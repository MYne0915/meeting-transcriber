# mac — 録音zip をローカルで文字起こしするCLI

`web/` の録音アプリが書き出した zip を受け取り、ローカルで文字起こしして Markdown を出力します。
文字起こしの負荷を録音端末から切り離すためのものです。

**音声は外部に送信されません。** 文字起こしは whisper.cpp をこのMac上で実行します。
API料金もかかりません。要約とノートの整形はこの後 Claude が行います。

## 前提

- Node 24 以上(TypeScript を直接実行します。ビルド不要、npm依存なし)
- `whisper-cpp` と `ffmpeg`

```sh
brew install whisper-cpp ffmpeg
```

文字起こしモデル(`ggml-large-v3-turbo.bin`、約1.6GB)は初回実行時に
`~/.cache/meeting-transcriber/models/` へ自動でダウンロードされます。

## 使い方

```sh
mac/bin/transcribe ~/Downloads/2026-08-01-meeting-audio.zip --name "会議名"
```

パスを通しておくと使いやすくなります。

```sh
ln -s "$PWD/mac/bin/transcribe" /usr/local/bin/transcribe
```

主なオプション:

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `--name` | なし | 見出しに使う会議名 |
| `--date` | zipのファイル名から推測 | frontmatter の `date` |
| `--project` | なし | frontmatter の `project` |
| `--tags` | `meeting` | カンマ区切り |
| `--out` | zipと同じディレクトリ | 出力先(ディレクトリまたは `.md` パス) |
| `--glossary` | `~/.config/meeting-transcriber/glossary.txt` | 固有名詞リスト |
| `--threads` | whisper.cppの既定 | スレッド数 |

出力は `YYYY-MM-DD-transcript.md` です。要約・固有名詞の照合・ファイル名の確定・保管先への配置は
Claude に頼んでください。

## 固有名詞リスト(glossary)

誤変換されやすい固有名詞を1行1語、あるいはカンマ区切りで書いておくと、
whisper.cpp の prompt に渡されて認識が安定します。

```
~/.config/meeting-transcriber/glossary.txt
```

このファイルはリポジトリの外に置きます。**このリポジトリは public なので、
社名・製品名・会議名などをコードやドキュメントに直接書かないでください。**
