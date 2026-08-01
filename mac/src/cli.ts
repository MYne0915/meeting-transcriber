#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type RecordingMetadata, extractSegments, readMetadata } from "./archive.ts";
import { buildTranscriptNote, transcriptFilename } from "./markdown.ts";
import { buildCombinedWav, checkDependencies, ensureModel, transcribeWav } from "./whisper.ts";

const DEFAULT_GLOSSARY = join(homedir(), ".config", "meeting-transcriber", "glossary.txt");

const USAGE = `使い方: transcribe <録音zip> [オプション]

録音アプリが書き出したzipをローカルで文字起こしし、Markdownとして出力します。
音声は外部に送信されません。要約とVaultへの配置はClaudeが行います。

会議名・プロジェクト・タグ・日付は、録音時に入力されていればzip内のmeta.jsonから
引き継がれます。下のオプションを指定した場合はそちらが優先されます。

オプション:
  --name <会議名>        見出しに使う
  --date <YYYY-MM-DD>    既定: meta.json → zipのファイル名 → 今日 の順で決定
  --project <名前>       frontmatterのproject
  --tags <a,b>           既定: meta.json、無ければ meeting
  --out <出力先>         ディレクトリまたは.mdパス。既定: zipと同じ場所
  --glossary <ファイル>  誤変換しやすい固有名詞リスト
                         既定: ${DEFAULT_GLOSSARY}
  --threads <n>          whisper.cppのスレッド数
  -h, --help             この使い方を表示`;

interface Flags {
  zipPath: string;
  meetingName?: string;
  date?: string;
  project?: string;
  tags?: string[];
  outPath?: string;
  glossaryPath: string;
  threads?: number;
}

interface Resolved {
  meetingName?: string;
  date: string;
  project?: string;
  tags: string[];
}

function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** The recorder names its zip "<YYYY-MM-DD>-meeting-audio.zip", so the meeting date is in the filename. */
function dateFromZipName(zipPath: string): string | undefined {
  return /(\d{4}-\d{2}-\d{2})/.exec(zipPath)?.[1];
}

function parseArgs(argv: string[]): Flags {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} に値が指定されていません`);
      flags.set(arg.slice(2), value);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) throw new Error("録音zipのパスを指定してください");
  if (positional.length > 1) throw new Error("録音zipは1つだけ指定してください");

  const zipPath = resolve(positional[0]);
  if (!existsSync(zipPath)) throw new Error(`ファイルが見つかりません: ${zipPath}`);

  const rawTags = flags.get("tags");
  const threads = flags.get("threads");

  return {
    zipPath,
    meetingName: flags.get("name"),
    date: flags.get("date"),
    project: flags.get("project"),
    tags: rawTags
      ?.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    outPath: flags.get("out"),
    glossaryPath: flags.get("glossary") ?? DEFAULT_GLOSSARY,
    threads: threads ? Number(threads) : undefined,
  };
}

/** Command-line flags win over what the recorder saved, so a wrong entry can be corrected here. */
function resolveDetails(flags: Flags, meta: RecordingMetadata): Resolved {
  return {
    meetingName: flags.meetingName ?? meta.meetingName,
    date: flags.date ?? meta.date ?? dateFromZipName(flags.zipPath) ?? todayIso(),
    project: flags.project ?? meta.project,
    tags: flags.tags ?? (meta.tags?.length ? meta.tags : ["meeting"]),
  };
}

/**
 * The glossary lives outside the repository on purpose: this repo is public, and the terms
 * that need correcting are internal product and company names.
 */
function readGlossary(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").trim() || undefined;
}

function resolveOutputPath(flags: Flags, date: string): string {
  const filename = transcriptFilename(date);
  if (!flags.outPath) return join(dirname(flags.zipPath), filename);
  const out = resolve(flags.outPath);
  return out.endsWith(".md") ? out : join(out, filename);
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    return;
  }

  const flags = parseArgs(argv);
  checkDependencies();
  const modelPath = ensureModel();

  const glossary = readGlossary(flags.glossaryPath);
  if (glossary) console.log(`固有名詞リストを読み込みました: ${flags.glossaryPath}`);

  const { dir, segments } = extractSegments(flags.zipPath);
  try {
    const details = resolveDetails(flags, readMetadata(dir));
    console.log(`会議名: ${details.meetingName ?? "(未設定)"} / 日付: ${details.date}`);
    console.log(`セグメント${segments.length}件を連結して文字起こしします`);

    const startedAll = Date.now();
    const wavPath = join(dir, "combined.wav");
    buildCombinedWav(
      segments.map((segment) => segment.path),
      wavPath,
    );

    const transcript = transcribeWav(wavPath, { modelPath, glossary, threads: flags.threads });
    if (!transcript) throw new Error("文字起こし結果が空でした");

    const outputPath = resolveOutputPath(flags, details.date);
    writeFileSync(
      outputPath,
      buildTranscriptNote({ ...details, transcript }),
      "utf8",
    );

    console.log(`\n合計 ${formatDuration(Date.now() - startedAll)}`);
    console.log(`書き出しました: ${outputPath}`);
    console.log("\nこの後はClaudeに「このファイルを議事録にしてVaultに入れて」と頼んでください。");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
