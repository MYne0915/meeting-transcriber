import type { SummarizeProgress } from "../summarize";

interface Props {
  hasTranscript: boolean;
  summarizing: boolean;
  loadProgress: SummarizeProgress | null;
  summary: string;
  webGPUAvailable: boolean | null;
  useCloudSummarizer: boolean;
  onSummarize: () => void;
  onChangeSummary: (text: string) => void;
}

export function SummaryView({
  hasTranscript,
  summarizing,
  loadProgress,
  summary,
  webGPUAvailable,
  useCloudSummarizer,
  onSummarize,
  onChangeSummary,
}: Props) {
  const localUnavailable = !useCloudSummarizer && webGPUAvailable === false;

  return (
    <section className="card">
      <h2>3. 議事録の要約</h2>

      {localUnavailable && (
        <p className="warning">
          このブラウザ/PCではWebGPUが使えないため、ブラウザ内要約は利用できません。文字起こし結果を手動で編集して議事録に使うか、設定でクラウドAPI要約を有効にしてください。
        </p>
      )}

      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={!hasTranscript || summarizing || localUnavailable}
          onClick={onSummarize}
        >
          {summarizing ? "要約生成中…" : "要約を生成"}
        </button>
      </div>

      {summarizing && loadProgress && (
        <p className="hint">
          {loadProgress.text || "モデル読み込み中…"} ({Math.round(loadProgress.progress * 100)}%)
        </p>
      )}

      <textarea
        className="summary"
        placeholder="要約(議事録の下書き)がここに表示されます。エクスポート前に自由に編集してください。"
        value={summary}
        onChange={(e) => onChangeSummary(e.target.value)}
        rows={14}
      />
    </section>
  );
}
