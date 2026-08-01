import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Transcription runs entirely on this machine via whisper.cpp, which is Metal-accelerated on
 * Apple Silicon. Nothing is uploaded, and there is no per-minute cost.
 */
const MODEL_DIR = join(homedir(), ".cache", "meeting-transcriber", "models");
const MODEL_FILE = "ggml-large-v3-turbo.bin";
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`;
/** The published model is ~1.6 GB; anything much smaller means a truncated or failed download. */
const MIN_MODEL_BYTES = 1_000_000_000;

function requireBinary(name: string, installHint: string): void {
  if (spawnSync("which", [name], { stdio: "ignore" }).status !== 0) {
    throw new Error(`${name} が見つかりません。${installHint}`);
  }
}

export function checkDependencies(): void {
  requireBinary("whisper-cli", "brew install whisper-cpp を実行してください");
  requireBinary("ffmpeg", "brew install ffmpeg を実行してください");
}

/** Downloads the model on first use into a cache dir, so setup is a single command for the user. */
export function ensureModel(): string {
  const modelPath = join(MODEL_DIR, MODEL_FILE);
  if (existsSync(modelPath) && statSync(modelPath).size >= MIN_MODEL_BYTES) return modelPath;

  mkdirSync(MODEL_DIR, { recursive: true });
  console.log(`文字起こしモデルをダウンロードします (約1.6GB、初回のみ)\n  ${modelPath}`);

  // Download to a temp name first so an interrupted download is never mistaken for a valid model.
  const partial = `${modelPath}.partial`;
  const result = spawnSync("curl", ["-L", "--fail", "--progress-bar", "-o", partial, MODEL_URL], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("モデルのダウンロードに失敗しました");
  if (statSync(partial).size < MIN_MODEL_BYTES) {
    throw new Error("ダウンロードしたモデルのサイズが想定より小さいです。再実行してください");
  }
  renameSync(partial, modelPath);
  return modelPath;
}

/**
 * Joins every recorded segment into one 16 kHz mono WAV (the only format whisper.cpp accepts).
 *
 * Joining first, rather than transcribing segment by segment, matters twice over: whisper.cpp
 * reloads the 1.6 GB model on every invocation (~4.4s each, so ~1 minute wasted on a 2-hour
 * meeting), and it carries decoding context across a file, which segment boundaries would cut.
 */
export function buildCombinedWav(inputPaths: string[], outputPath: string): void {
  const inputs = inputPaths.flatMap((path) => ["-i", path]);
  const filter = `${inputPaths.map((_, i) => `[${i}:a]`).join("")}concat=n=${inputPaths.length}:v=0:a=1[out]`;

  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        ...inputs,
        "-filter_complex", filter,
        "-map", "[out]",
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        outputPath,
      ],
      { stdio: "ignore" },
    );
  } catch {
    throw new Error("音声の変換・連結に失敗しました");
  }
}

export interface TranscribeOptions {
  modelPath: string;
  /** Proper nouns to bias the decoder's vocabulary toward, reducing recurring mis-transcriptions. */
  glossary?: string;
  threads?: number;
}

export function transcribeWav(wavPath: string, options: TranscribeOptions): string {
  const outputPrefix = wavPath.replace(/\.wav$/, "");
  const args = [
    "-m", options.modelPath,
    "-f", wavPath,
    "-l", "ja",
    "-otxt",
    "-of", outputPrefix,
    // -nt is omitted so the console gets a timestamped stream that doubles as a progress display.
  ];
  if (options.threads) args.push("-t", String(options.threads));
  if (options.glossary) args.push("--prompt", options.glossary);

  // whisper.cpp reports progress on stderr; let it through so long runs stay visible.
  const result = spawnSync("whisper-cli", args, { stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) throw new Error("文字起こしに失敗しました");

  const textPath = `${outputPrefix}.txt`;
  if (!existsSync(textPath)) throw new Error("文字起こし結果のファイルが生成されませんでした");
  return breakIntoSentences(readFileSync(textPath, "utf8"));
}

/**
 * Puts one sentence per line. Passing --prompt makes whisper.cpp emit the whole recording as a
 * single segment, so without this a 2-hour meeting arrives as one unreadable line. The glossary
 * is worth keeping regardless — it is what corrects proper nouns — so the line breaks are
 * reconstructed here instead.
 */
function breakIntoSentences(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => line.split(/(?<=。)/))
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .join("\n");
}
