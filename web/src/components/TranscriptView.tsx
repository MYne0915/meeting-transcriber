import type { TranscribeDevice, TranscribeProgress } from "../transcribe";

interface Props {
  hasAudio: boolean;
  transcribing: boolean;
  progress: TranscribeProgress | null;
  device: TranscribeDevice | null;
  elapsedMs: number | null;
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
  transcript,
  onTranscribe,
  onChangeTranscript,
}: Props) {
  return (
    <section className="card">
      <h2>2. 文字起こし</h2>

      <div className="row">
        <button type="button" className="primary" disabled={!hasAudio || transcribing} onClick={onTranscribe}>
          {transcribing ? "文字起こし中…" : "文字起こし開始"}
        </button>
      </div>

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
      {transcribing && !progress && <p className="hint">音声を解析しています…(初回はモデルのダウンロードに時間がかかります)</p>}
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
