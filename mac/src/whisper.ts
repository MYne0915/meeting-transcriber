import { spawnSync } from "node:child_process";
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

/**
 * whisper.cpp occasionally gets stuck repeating the same line dozens or hundreds of times on
 * noisy or overlapping-speech audio (observed: the same short phrase emitted 219 times in a row
 * on a real meeting recording). This many identical consecutive sentences is treated as that
 * loop rather than genuine repeated speech, and collapsed after the fact — see collapseRepeats
 * for why this can't be caught by watching the process live instead.
 */
const LOOP_REPEAT_THRESHOLD = 8;

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
 * Converts one recorded segment to the 16 kHz mono WAV whisper.cpp requires.
 *
 * Segments are transcribed one at a time (not joined into one file first) so that a
 * repetition loop (see LOOP_REPEAT_THRESHOLD) is caught and cut off within a single ~10-minute
 * segment instead of derailing transcription of the whole meeting. The cost is whisper.cpp
 * reloading its 1.6 GB model on every invocation (~4.4s each, so ~1 minute on a 2-hour
 * meeting's 12 segments), which is worth paying for that fault isolation.
 */
export function convertToWav(inputPath: string, outputPath: string): void {
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath],
    { stdio: "ignore" },
  );
  if (result.status !== 0) throw new Error(`音声の変換に失敗しました: ${inputPath}`);
}

export interface TranscribeOptions {
  modelPath: string;
  /** Proper nouns to bias the decoder's vocabulary toward, reducing recurring mis-transcriptions. */
  glossary?: string;
  threads?: number;
}

export interface TranscribeResult {
  text: string;
  /** True if a repetition loop was found and collapsed in the output. */
  loopDetected: boolean;
}

/**
 * Runs whisper.cpp on one WAV and returns its transcript, with any repetition loop collapsed.
 *
 * whisper.cpp reports progress as timestamped lines on stderr; -inherit- lets that reach the
 * console as before, purely for visibility. Watching those lines live to kill the process
 * early (an earlier approach here) does not work: whisper.cpp's stdio is fully buffered once
 * it isn't a TTY, so on a real run the entire transcript — including a 219-line repetition
 * loop observed on a real meeting recording — arrived in one burst right as the process
 * exited. By the time a repeat was visible, there was nothing left to cut off. So the loop is
 * instead detected and collapsed after the process has already finished, in collapseRepeats.
 */
export function transcribeWav(wavPath: string, options: TranscribeOptions): TranscribeResult {
  const outputPrefix = wavPath.replace(/\.wav$/, "");
  const args = [
    "-m", options.modelPath,
    "-f", wavPath,
    "-l", "ja",
    "-otxt",
    "-of", outputPrefix,
  ];
  if (options.threads) args.push("-t", String(options.threads));
  if (options.glossary) args.push("--prompt", options.glossary);

  const result = spawnSync("whisper-cli", args, { stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) throw new Error("文字起こしに失敗しました");

  const textPath = `${outputPrefix}.txt`;
  if (!existsSync(textPath)) throw new Error("文字起こし結果のファイルが生成されませんでした");

  return collapseRepeats(breakIntoSentences(readFileSync(textPath, "utf8")));
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

/**
 * Collapses runs of LOOP_REPEAT_THRESHOLD+ identical consecutive sentences (whisper.cpp stuck
 * repeating itself) down to one copy plus a marker, so a hallucination loop doesn't bury an
 * otherwise-fine transcript in hundreds of duplicate lines.
 */
function collapseRepeats(text: string): TranscribeResult {
  const lines = text.split("\n");
  const collapsed: string[] = [];
  let loopDetected = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    let runLength = 1;
    while (i + runLength < lines.length && lines[i + runLength] === line) runLength++;

    collapsed.push(line);
    if (runLength >= LOOP_REPEAT_THRESHOLD) {
      loopDetected = true;
      collapsed.push(`[同一の発言が${runLength}回繰り返されたため以降を省略しました。この付近は文字起こしが不安定だった可能性があります]`);
    } else {
      for (let j = 1; j < runLength; j++) collapsed.push(line);
    }
    i += runLength;
  }

  return { text: collapsed.join("\n"), loopDetected };
}
