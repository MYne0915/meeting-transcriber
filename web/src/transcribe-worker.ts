/// <reference lib="webworker" />
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type WhisperModelId =
  | "onnx-community/whisper-large-v3-turbo"
  | "onnx-community/kotoba-whisper-v2.2-ONNX";

export interface TranscribeRequest {
  type: "transcribe";
  audio: Float32Array;
  modelId: WhisperModelId;
}

export type TranscribeWorkerMessage =
  | { type: "loading"; progress: number; file: string }
  | { type: "result"; text: string }
  | { type: "error"; message: string };

let cachedModelId: WhisperModelId | undefined;
let cachedPipeline: AutomaticSpeechRecognitionPipeline | undefined;

// Cast to a loose signature: the library's overload set (keyed by a large task/model
// literal union) makes TS give up ("union type too complex") when called normally.
const createPipeline = pipeline as unknown as (
  task: string,
  model: string,
  options: Record<string, unknown>,
) => Promise<AutomaticSpeechRecognitionPipeline>;

async function getPipeline(modelId: WhisperModelId): Promise<AutomaticSpeechRecognitionPipeline> {
  if (cachedPipeline && cachedModelId === modelId) return cachedPipeline;

  const hasWebGPU = "gpu" in navigator;
  cachedPipeline = await createPipeline("automatic-speech-recognition", modelId, {
    device: hasWebGPU ? "webgpu" : "wasm",
    dtype: {
      encoder_model: "fp32",
      decoder_model_merged: "q4",
    },
    progress_callback: (data: { status: string; file?: string; progress?: number }) => {
      if (data.status === "progress" && data.file != null && data.progress != null) {
        const message: TranscribeWorkerMessage = {
          type: "loading",
          progress: data.progress,
          file: data.file,
        };
        self.postMessage(message);
      }
    },
  });
  cachedModelId = modelId;
  return cachedPipeline;
}

self.onmessage = async (event: MessageEvent<TranscribeRequest>) => {
  const { type, audio, modelId } = event.data;
  if (type !== "transcribe") return;

  try {
    const transcriber = await getPipeline(modelId);
    const output = await transcriber(audio, {
      language: "japanese",
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    const text = Array.isArray(output) ? output.map((o) => o.text).join("\n") : output.text;
    const message: TranscribeWorkerMessage = { type: "result", text };
    self.postMessage(message);
  } catch (err) {
    const message: TranscribeWorkerMessage = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(message);
  }
};
