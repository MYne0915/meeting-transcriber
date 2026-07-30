import type { MLCEngineInterface } from "@mlc-ai/web-llm";

const LOCAL_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

const SYSTEM_PROMPT = `あなたは日本語の会議の文字起こしから議事録を作成するアシスタントです。
与えられた文字起こしテキストを読み、以下の形式のMarkdownだけを出力してください(前置き・説明文は不要です)。

# 議事録: <会議内容を要約した短いタイトル>

## <議題・話題のセクション見出し>
- <決定事項・議論内容の要点を箇条書きで>
- <次のアクション項目があれば>

セクションは話題ごとに分け、要点は簡潔にまとめてください。日時や参加者名など文字起こしに含まれない情報は書かないでください。`;

export interface SummarizeProgress {
  text: string;
  progress: number;
}

let engine: MLCEngineInterface | undefined;

export async function isWebGPUAvailable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return adapter != null;
  } catch {
    return false;
  }
}

export async function loadLocalSummarizer(
  onProgress?: (p: SummarizeProgress) => void,
): Promise<void> {
  const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
  engine = await CreateMLCEngine(LOCAL_MODEL_ID, {
    initProgressCallback: (report) => onProgress?.({ text: report.text, progress: report.progress }),
  });
}

export function isLocalSummarizerLoaded(): boolean {
  return engine != null;
}

export async function summarizeLocally(transcript: string): Promise<string> {
  if (!engine) throw new Error("要約モデルがまだ読み込まれていません");
  const completion = await engine.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: transcript },
    ],
    temperature: 0.3,
  });
  return completion.choices[0]?.message?.content ?? "";
}

export interface CloudApiConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

/** Sends only the transcript text (never audio) to an OpenAI-compatible chat completions endpoint. */
export async function summarizeViaCloudApi(
  transcript: string,
  config: CloudApiConfig,
): Promise<string> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      temperature: 0.3,
    }),
  });
  if (!response.ok) {
    throw new Error(`要約APIエラー: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("要約APIの応答形式が想定と異なります");
  }
  return content;
}
