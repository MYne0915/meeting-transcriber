import type { WhisperModelId } from "../transcribe-worker";

export interface AppSettings {
  whisperModel: WhisperModelId;
  forceWasmTranscribe: boolean;
  useCloudSummarizer: boolean;
  cloudEndpoint: string;
  cloudApiKey: string;
  cloudModel: string;
}

const STORAGE_KEY = "meeting-transcriber:settings";

export const DEFAULT_SETTINGS: AppSettings = {
  whisperModel: "onnx-community/whisper-large-v3-turbo",
  forceWasmTranscribe: false,
  useCloudSummarizer: false,
  cloudEndpoint: "https://api.openai.com/v1/chat/completions",
  cloudApiKey: "",
  cloudModel: "gpt-4o-mini",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

interface Props {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

export function SettingsPanel({ settings, onChange }: Props) {
  return (
    <section className="card">
      <h2>設定</h2>

      <label className="field">
        文字起こしモデル
        <select
          value={settings.whisperModel}
          onChange={(e) =>
            onChange({ ...settings, whisperModel: e.target.value as WhisperModelId })
          }
        >
          <option value="onnx-community/whisper-large-v3-turbo">
            Whisper large-v3-turbo(多言語・英語混じり技術用語に強い)
          </option>
          <option value="onnx-community/kotoba-whisper-v2.2-ONNX">
            kotoba-whisper(日本語特化・高速)
          </option>
        </select>
      </label>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={settings.forceWasmTranscribe}
          onChange={(e) => onChange({ ...settings, forceWasmTranscribe: e.target.checked })}
        />
        文字起こしでWebGPUを使わない(CPUで強制実行)
      </label>
      <p className="hint">
        WebGPU使用時に文字起こしが固まって進まない場合に試してください。処理は遅くなりますが、内蔵GPU等でのWebGPU初期化の不具合を回避できることがあります。
      </p>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={settings.useCloudSummarizer}
          onChange={(e) => onChange({ ...settings, useCloudSummarizer: e.target.checked })}
        />
        要約にクラウドAPIを使う(既定はオフ = 文字起こしテキストも一切外部送信しません)
      </label>

      {settings.useCloudSummarizer && (
        <div className="cloud-settings">
          <p className="warning">
            ここで入力したテキストはAPI送信先に送られます。機密性の高い会議では使用前に社内IT方針を確認してください。
          </p>
          <label className="field">
            APIエンドポイント(OpenAI互換 chat completions)
            <input
              type="text"
              value={settings.cloudEndpoint}
              onChange={(e) => onChange({ ...settings, cloudEndpoint: e.target.value })}
            />
          </label>
          <label className="field">
            モデル名
            <input
              type="text"
              value={settings.cloudModel}
              onChange={(e) => onChange({ ...settings, cloudModel: e.target.value })}
            />
          </label>
          <label className="field">
            APIキー(このブラウザのlocalStorageにのみ保存されます)
            <input
              type="password"
              value={settings.cloudApiKey}
              onChange={(e) => onChange({ ...settings, cloudApiKey: e.target.value })}
            />
          </label>
        </div>
      )}
    </section>
  );
}
