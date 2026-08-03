import { useEffect, useRef, useState } from "react";
import "./App.css";
import { type CaptureOptions, type CaptureSession, startCapture } from "./audio-capture";
import { downloadRecordingAsZip, extensionForMimeType, extensionFromFilename } from "./audio-export";
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

  const [sourceMode, setSourceMode] = useState<"record" | "upload">("record");
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const sessionRef = useRef<CaptureSession | null>(null);
  const recordingStartRef = useRef(0);
  const [audioSegments, setAudioSegments] = useState<Blob[]>([]);
  const [segmentExtension, setSegmentExtension] = useState("webm");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
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
      setSegmentExtension(extensionForMimeType(session.mimeType));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      sessionRef.current = null;
      setRecording(false);
    }
  }

  function handleSourceModeChange(mode: "record" | "upload") {
    if (recording) return;
    setSourceMode(mode);
    setAudioSegments([]);
    setUploadedFileName(null);
  }

  function handleFileUpload(file: File | undefined | null) {
    if (!file) return;
    setError(null);
    setAudioSegments([file]);
    setSegmentExtension(extensionFromFilename(file.name) ?? extensionForMimeType(file.type));
    setUploadedFileName(file.name);
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
        segmentExtension,
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
        録音・アップロードはこのブラウザの中だけで実行され、音声は一切外部に送信されません。文字起こし・要約は別端末で行うため、ここでは音源の準備とエクスポートのみを行います。
      </p>

      {error && <div className="error">{error}</div>}

      <section className="card">
        <h2>1. 音源</h2>

        <div className="row">
          <label className="field checkbox">
            <input
              type="radio"
              name="source-mode"
              checked={sourceMode === "record"}
              disabled={recording}
              onChange={() => handleSourceModeChange("record")}
            />
            録音する
          </label>
          <label className="field checkbox">
            <input
              type="radio"
              name="source-mode"
              checked={sourceMode === "upload"}
              disabled={recording}
              onChange={() => handleSourceModeChange("upload")}
            />
            音源ファイルをアップロード
          </label>
        </div>

        {sourceMode === "record" ? (
          <RecorderPanel
            recording={recording}
            elapsedLabel={formatElapsed(elapsedMs)}
            onStart={handleStart}
            onStop={handleStop}
          />
        ) : (
          <div className="field">
            音声ファイル(mp3 / m4a / wav / webm など)
            <input
              type="file"
              accept="audio/*,video/webm,video/mp4"
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
            />
            {uploadedFileName && <p className="hint">選択中: {uploadedFileName}</p>}
          </div>
        )}
      </section>

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
          ここで入力した内容はzipの中に一緒に保存され、文字起こしする端末で引き継がれます。
          {sourceMode === "record"
            ? "録音を10分ごとのセグメントに分割してダウンロードします。"
            : "アップロードした音声ファイルをそのままzipに格納してダウンロードします。"}
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
