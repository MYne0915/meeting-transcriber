import { useEffect, useRef, useState } from "react";
import "./App.css";
import { type CaptureOptions, type CaptureSession, startCapture } from "./audio-capture";
import { buildMeetingMinutesMarkdown, downloadMarkdown, suggestFilename } from "./markdown-export";
import {
  type SummarizeProgress,
  isLocalSummarizerLoaded,
  isWebGPUAvailable,
  loadLocalSummarizer,
  summarizeLocally,
  summarizeViaCloudApi,
} from "./summarize";
import { type TranscribeProgress, transcribeAudio } from "./transcribe";
import { DEFAULT_SETTINGS, SettingsPanel, loadSettings, saveSettings } from "./components/SettingsPanel";
import { RecorderPanel } from "./components/RecorderPanel";
import { TranscriptView } from "./components/TranscriptView";
import { SummaryView } from "./components/SummaryView";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const sessionRef = useRef<CaptureSession | null>(null);
  const recordingStartRef = useRef(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const [transcribing, setTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState<TranscribeProgress | null>(null);
  const [transcript, setTranscript] = useState("");

  const [summarizing, setSummarizing] = useState(false);
  const [summaryProgress, setSummaryProgress] = useState<SummarizeProgress | null>(null);
  const [summary, setSummary] = useState("");
  const [webGPUAvailable, setWebGPUAvailable] = useState<boolean | null>(null);

  const [date, setDate] = useState(todayIso());
  const [tags, setTags] = useState("mizuho, meeting");
  const [project, setProject] = useState("");
  const [topicSlug, setTopicSlug] = useState("");

  useEffect(() => {
    setSettings(loadSettings());
    isWebGPUAvailable().then(setWebGPUAvailable);
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - recordingStartRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, [recording]);

  async function handleStart(options: CaptureOptions) {
    setError(null);
    try {
      const session = await startCapture(options);
      sessionRef.current = session;
      recordingStartRef.current = Date.now();
      setElapsedMs(0);
      setAudioBlob(null);
      setTranscript("");
      setSummary("");
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStop() {
    const session = sessionRef.current;
    if (!session) return;
    try {
      const blob = await session.stop();
      setAudioBlob(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      sessionRef.current = null;
      setRecording(false);
    }
  }

  async function handleTranscribe() {
    if (!audioBlob) return;
    setError(null);
    setTranscribing(true);
    setTranscribeProgress(null);
    try {
      const text = await transcribeAudio(audioBlob, settings.whisperModel, setTranscribeProgress);
      setTranscript(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing(false);
    }
  }

  async function handleSummarize() {
    if (!transcript) return;
    setError(null);
    setSummarizing(true);
    setSummaryProgress(null);
    try {
      if (settings.useCloudSummarizer) {
        const text = await summarizeViaCloudApi(transcript, {
          endpoint: settings.cloudEndpoint,
          apiKey: settings.cloudApiKey,
          model: settings.cloudModel,
        });
        setSummary(text);
      } else {
        if (!isLocalSummarizerLoaded()) {
          await loadLocalSummarizer(setSummaryProgress);
        }
        const text = await summarizeLocally(transcript);
        setSummary(text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSummarizing(false);
    }
  }

  function handleDownload() {
    if (!summary) return;
    const content = buildMeetingMinutesMarkdown({
      date,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      project: project || undefined,
      summaryMarkdown: summary,
    });
    downloadMarkdown(suggestFilename(date, topicSlug), content);
  }

  return (
    <div className="app">
      <h1>議事録メーカー</h1>
      <p className="lead">
        録音・文字起こし・要約はすべてこのブラウザの中だけで実行され、音声やテキストは既定では一切外部に送信されません。
      </p>

      {error && <div className="error">{error}</div>}

      <RecorderPanel
        recording={recording}
        elapsedLabel={formatElapsed(elapsedMs)}
        onStart={handleStart}
        onStop={handleStop}
      />

      <TranscriptView
        hasAudio={audioBlob != null}
        transcribing={transcribing}
        progress={transcribeProgress}
        transcript={transcript}
        onTranscribe={handleTranscribe}
        onChangeTranscript={setTranscript}
      />

      <SummaryView
        hasTranscript={transcript.length > 0}
        summarizing={summarizing}
        loadProgress={summaryProgress}
        summary={summary}
        webGPUAvailable={webGPUAvailable}
        useCloudSummarizer={settings.useCloudSummarizer}
        onSummarize={handleSummarize}
        onChangeSummary={setSummary}
      />

      <section className="card">
        <h2>4. Markdownとして書き出し</h2>
        <div className="export-grid">
          <label className="field">
            日時
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            タグ(カンマ区切り)
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label className="field">
            プロジェクト(任意)
            <input type="text" value={project} onChange={(e) => setProject(e.target.value)} />
          </label>
          <label className="field">
            ファイル名の話題部分(例: circuit-teirei)
            <input
              type="text"
              value={topicSlug}
              onChange={(e) => setTopicSlug(e.target.value)}
              placeholder="meeting"
            />
          </label>
        </div>
        <p className="hint">
          ダウンロード後、Obsidian Vaultの Meetings/ フォルダに手動で配置してください(会社PCから個人Vaultへの自動同期は行いません)。
        </p>
        <div className="row">
          <button type="button" className="primary" disabled={!summary} onClick={handleDownload}>
            .mdをダウンロード
          </button>
        </div>
      </section>

      <SettingsPanel settings={settings} onChange={setSettings} />
    </div>
  );
}
