import { useEffect, useRef, useState } from "react";
import "./App.css";
import { type CaptureOptions, type CaptureSession, startCapture } from "./audio-capture";
import { downloadRecordingAsZip } from "./audio-export";
import {
  loadLastTags,
  loadMeetingNameHistory,
  loadProjectHistory,
  rememberMeetingName,
  rememberProject,
  rememberTags,
} from "./name-history";
import { RecorderPanel } from "./components/RecorderPanel";

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
  const [error, setError] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const sessionRef = useRef<CaptureSession | null>(null);
  const recordingStartRef = useRef(0);
  const [audioSegments, setAudioSegments] = useState<Blob[]>([]);
  const [exporting, setExporting] = useState(false);
  const [recordedDate, setRecordedDate] = useState(todayIso());

  const [meetingName, setMeetingName] = useState("");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState(() => loadLastTags());
  const [meetingNameHistory, setMeetingNameHistory] = useState(() => loadMeetingNameHistory());
  const [projectHistory, setProjectHistory] = useState(() => loadProjectHistory());

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
      setAudioSegments([]);
      setRecordedDate(todayIso());
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStop() {
    const session = sessionRef.current;
    if (!session) return;
    try {
      const segments = await session.stop();
      setAudioSegments(segments);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      sessionRef.current = null;
      setRecording(false);
    }
  }

  async function handleExport() {
    if (audioSegments.length === 0) return;
    setError(null);
    setExporting(true);
    try {
      await downloadRecordingAsZip(
        audioSegments,
        {
          date: recordedDate,
          meetingName: meetingName || undefined,
          project: project || undefined,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
        `${recordedDate}-meeting-audio.zip`,
      );

      if (meetingName) {
        rememberMeetingName(meetingName);
        setMeetingNameHistory(loadMeetingNameHistory());
      }
      if (project) {
        rememberProject(project);
        setProjectHistory(loadProjectHistory());
      }
      rememberTags(tags);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app">
      <h1>議事録メーカー(録音)</h1>
      <p className="lead">
        録音はこのブラウザの中だけで実行され、音声は一切外部に送信されません。文字起こし・要約は別端末で行うため、ここでは録音とエクスポートのみを行います。
      </p>

      {error && <div className="error">{error}</div>}

      <RecorderPanel
        recording={recording}
        elapsedLabel={formatElapsed(elapsedMs)}
        onStart={handleStart}
        onStop={handleStop}
      />

      <section className="card">
        <h2>2. エクスポート</h2>

        <div className="export-grid">
          <label className="field">
            会議名
            <input
              type="text"
              list="meeting-name-options"
              value={meetingName}
              onChange={(e) => setMeetingName(e.target.value)}
            />
            <datalist id="meeting-name-options">
              {meetingNameHistory.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          </label>
          <label className="field">
            プロジェクト
            <input
              type="text"
              list="project-options"
              value={project}
              onChange={(e) => setProject(e.target.value)}
            />
            <datalist id="project-options">
              {projectHistory.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          </label>
          <label className="field">
            日付
            <input type="date" value={recordedDate} onChange={(e) => setRecordedDate(e.target.value)} />
          </label>
          <label className="field">
            タグ
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
        </div>

        <p className="hint">
          ここで入力した内容はzipの中に一緒に保存され、文字起こしする端末で引き継がれます。録音を10分ごとのセグメントに分割してダウンロードします。
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={audioSegments.length === 0 || exporting}
            onClick={handleExport}
          >
            {exporting ? "書き出し中…" : "zipをダウンロード"}
          </button>
        </div>
      </section>
    </div>
  );
}
