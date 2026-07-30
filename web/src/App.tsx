import { useEffect, useRef, useState } from "react";
import "./App.css";
import { type CaptureOptions, type CaptureSession, startCapture } from "./audio-capture";
import { buildMeetingMinutesMarkdown, downloadMarkdown, suggestFilename } from "./markdown-export";
import {
  loadLastTags,
  loadMeetingNameHistory,
  loadProjectHistory,
  rememberMeetingName,
  rememberProject,
  rememberTags,
} from "./name-history";
import {
  type SummarizeProgress,
  isLocalSummarizerLoaded,
  isWebGPUAvailable,
  loadLocalSummarizer,
  summarizeLocally,
  summarizeViaCloudApi,
} from "./summarize";
import { type TranscribeDevice, type TranscribeProgress, transcribeAudio } from "./transcribe";
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
  const [transcribeDevice, setTranscribeDevice] = useState<TranscribeDevice | null>(null);
  const [transcribeElapsedMs, setTranscribeElapsedMs] = useState<number | null>(null);
  const [transcript, setTranscript] = useState("");

  const [summarizing, setSummarizing] = useState(false);
  const [summaryProgress, setSummaryProgress] = useState<SummarizeProgress | null>(null);
  const [summary, setSummary] = useState("");
  const [webGPUAvailable, setWebGPUAvailable] = useState<boolean | null>(null);

  const [date, setDate] = useState(todayIso());
  const [tags, setTags] = useState(() => loadLastTags());
  const [project, setProject] = useState("");
  const [meetingName, setMeetingName] = useState("");
  const [topicSlug, setTopicSlug] = useState("");
  const [meetingNameHistory, setMeetingNameHistory] = useState(() => loadMeetingNameHistory());
  const [projectHistory, setProjectHistory] = useState(() => loadProjectHistory());

  function handleMeetingNameChange(name: string) {
    setMeetingName(name);
    const known = meetingNameHistory.find((entry) => entry.title === name);
    if (known) setTopicSlug(known.slug);
  }

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
    setTranscribeDevice(null);
    setTranscribeElapsedMs(null);
    setTranscript("");
    try {
      const result = await transcribeAudio(
        audioBlob,
        settings.whisperModel,
        settings.forceWasmTranscribe,
        setTranscribeProgress,
        setTranscribeDevice,
        setTranscript,
      );
      setTranscript(result.text);
      setTranscribeElapsedMs(result.elapsedMs);
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
      meetingName: meetingName || undefined,
      summaryMarkdown: summary,
    });
    downloadMarkdown(suggestFilename(date, topicSlug), content);

    if (meetingName) {
      rememberMeetingName(meetingName, topicSlug);
      setMeetingNameHistory(loadMeetingNameHistory());
    }
    if (project) {
      rememberProject(project);
      setProjectHistory(loadProjectHistory());
    }
    rememberTags(tags);
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
        device={transcribeDevice}
        elapsedMs={transcribeElapsedMs}
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
            会議名(過去に入力した定例名がリストに出ます。初回は自由入力してください)
            <input
              type="text"
              list="meeting-name-options"
              value={meetingName}
              onChange={(e) => handleMeetingNameChange(e.target.value)}
              placeholder="定例会議名など"
            />
            <datalist id="meeting-name-options">
              {meetingNameHistory.map((entry) => (
                <option key={entry.slug} value={entry.title} />
              ))}
            </datalist>
          </label>
          <label className="field">
            プロジェクト(任意、過去の入力がリストに出ます)
            <input type="text" list="project-options" value={project} onChange={(e) => setProject(e.target.value)} />
            <datalist id="project-options">
              {projectHistory.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="field">
            ファイル名(スラッグ、会議名選択で自動入力)
            <input
              type="text"
              value={topicSlug}
              onChange={(e) => setTopicSlug(e.target.value)}
              placeholder="meeting"
            />
          </label>
        </div>
        <p className="hint">
          ダウンロード後、メール添付やクラウドストレージなど任意の方法でVaultのある端末に転送し、Meetings/ フォルダへ配置してください(このPCからの自動同期は行いません)。
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
