import { useEffect, useState } from "react";
import type { TranscribeDevice, TranscribeProgress } from "../transcribe";

interface Props {
  hasAudio: boolean;
  transcribing: boolean;
  progress: TranscribeProgress | null;
  device: TranscribeDevice | null;
  elapsedMs: number | null;
  segmentProgress: { current: number; total: number } | null;
  transcript: string;
  onTranscribe: () => void;
  onChangeTranscript: (text: string) => void;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}秒`;
}

export function TranscriptView({
  hasAudio,
  transcribing,
  progress,
  device,
  elapsedMs,
  segmentProgress,
  transcript,
  onTranscribe,
  onChangeTranscript,
}: Props) {
  const [waitedSeconds, setWaitedSeconds] = useState(0);

  useEffect(() => {
    if (!transcribing) {
      setWaitedSeconds(0);
      return;
    }
    setWaitedSeconds(0);
    const interval = setInterval(() => setWaitedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
    // Resets the per-segment stall timer whenever a new segment starts, not just on transcribing start/stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcribing, segmentProgress?.current]);

  return (
    <section className="card">
      <h2>2. 文字起こし</h2>

      <div className="row">
        <button type="button" className="primary" disabled={!hasAudio || transcribing} onClick={onTranscribe}>
          {transcribing ? `文字起こし中…(${waitedSeconds}秒経過)` : "文字起こし開始"}
        </button>
      </div>

      {segmentProgress && segmentProgress.total > 1 && (
        <p className="hint">
          長い録音のため{segmentProgress.total}分割で処理中: セグメント {segmentProgress.current}/
          {segmentProgress.total}
        </p>
      )}
      {device && (
        <p className={device === "webgpu" ? "hint" : "warning"}>
          {device === "webgpu"
            ? "⚡ WebGPUを検出しました(GPUで実行中)"
            : "⚠ WebGPUが使えないため、CPU(WASM)で実行中です。時間がかかることがあります"}
        </p>
      )}
      {transcribing && progress && (
        <p className="hint">
          モデル読み込み中: {progress.file} ({Math.round(progress.progress)}%)
        </p>
      )}
      {transcribing && progress && waitedSeconds >= 60 && (
        <p className="hint">
          ダウンロードに時間がかかっています。パーセントが少しずつでも進んでいれば異常ではありません(回線が遅いだけです)。一度ダウンロードすればブラウザにキャッシュされるため、次回以降はこの待ち時間は発生しません。
        </p>
      )}
      {transcribing && !progress && transcript.length === 0 && (
        <p className="hint">音声を解析しています…</p>
      )}
      {transcribing && !progress && transcript.length > 0 && (
        <p className="hint">生成中…(下のテキストはリアルタイムで更新されます)</p>
      )}
      {transcribing && !progress && waitedSeconds >= 90 && transcript.length === 0 && (
        <p className="warning">
          モデルの読み込みは完了しているのに90秒以上、文字が全く表示されていません。WebGPUの初期化が固まっている可能性があります。下の設定で「WebGPUを使わない(CPUで強制実行)」を試してください。
        </p>
      )}
      {!transcribing && elapsedMs != null && (
        <p className="hint">文字起こし完了(処理時間: {formatSeconds(elapsedMs)})</p>
      )}

      <textarea
        className="transcript"
        placeholder="文字起こし結果がここに表示されます(手動で編集も可能です)"
        value={transcript}
        onChange={(e) => onChangeTranscript(e.target.value)}
        rows={10}
      />
    </section>
  );
}
