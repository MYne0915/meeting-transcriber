import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AUDIO_EXTENSIONS = [".webm", ".m4a", ".mp3", ".mp4", ".ogg", ".oga", ".wav", ".flac"];

export interface ExtractedSegment {
  path: string;
  name: string;
  bytes: number;
}

/** Written by the recorder app into the zip, so the meeting is identified while the context is fresh. */
export interface RecordingMetadata {
  date?: string;
  meetingName?: string;
  project?: string;
  tags?: string[];
}

/** Zips recorded before meta.json existed simply have none, so a missing file is not an error. */
export function readMetadata(dir: string): RecordingMetadata {
  const path = join(dir, "meta.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RecordingMetadata;
  } catch {
    console.warn("meta.json を読めませんでした。オプションの指定値のみ使用します");
    return {};
  }
}

/**
 * Extracts the recorder's zip into a temp directory and returns its audio segments in
 * recording order. Segments are named segment-01, segment-02, … so a plain sort is correct.
 */
export function extractSegments(zipPath: string): { dir: string; segments: ExtractedSegment[] } {
  const dir = mkdtempSync(join(tmpdir(), "meeting-transcriber-"));
  try {
    execFileSync("unzip", ["-qq", "-o", zipPath, "-d", dir]);
  } catch {
    throw new Error(`zipを展開できませんでした: ${zipPath}`);
  }

  const segments = readdirSync(dir)
    .filter((name) => AUDIO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      return { path, name, bytes: statSync(path).size };
    });

  if (segments.length === 0) {
    throw new Error("zipの中に音声ファイルが見つかりませんでした");
  }
  return { dir, segments };
}
