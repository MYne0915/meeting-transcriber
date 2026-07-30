/// <reference lib="webworker" />
import { pipeline, WhisperTextStreamer, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type WhisperModelId =
  | "onnx-community/whisper-large-v3-turbo"
  | "onnx-community/kotoba-whisper-v2.2-ONNX";

export interface TranscribeRequest {
  type: "transcribe";
  audio: Float32Array;
  modelId: WhisperModelId;
  forceWasm: boolean;
}

export type TranscribeDevice = "webgpu" | "wasm";

export type TranscribeWorkerMessage =
  | { type: "device"; device: TranscribeDevice }
  | { type: "loading"; progress: number; file: string }
  | { type: "partial"; text: string }
  | { type: "result"; text: string; elapsedMs: number }
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

/** Actual adapter availability, not just API presence (navigator.gpu can exist with no usable adapter). */
async function detectDevice(): Promise<TranscribeDevice> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return "wasm";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter != null ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

async function getPipeline(
  modelId: WhisperModelId,
  forceWasm: boolean,
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (cachedPipeline && cachedModelId === modelId) return cachedPipeline;

  const device = forceWasm ? "wasm" : await detectDevice();
  self.postMessage({ type: "device", device } satisfies TranscribeWorkerMessage);
  cachedPipeline = await createPipeline("automatic-speech-recognition", modelId, {
    device,
    dtype: {
      // fp32 encoder exceeds 2GB, forcing onnxruntime-web's external-data (.onnx_data) loading
      // path, which is broken for these models (fails with "Module.MountedFiles is not
      // available" — see https://github.com/huggingface/transformers.js/issues/989). fp16
      // keeps the encoder under 2GB and avoids external data entirely.
      encoder_model: "fp16",
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
  const { type, audio, modelId, forceWasm } = event.data;
  if (type !== "transcribe") return;

  try {
    const transcriber = await getPipeline(modelId, forceWasm);
    const startedAt = performance.now();
    let partialText = "";
    // Pipeline exposes the base tokenizer type, but at runtime whisper models use WhisperTokenizer.
    const streamer = new WhisperTextStreamer(transcriber.tokenizer as never, {
      skip_prompt: true,
      callback_function: (piece: string) => {
        partialText += piece;
        self.postMessage({ type: "partial", text: partialText } satisfies TranscribeWorkerMessage);
      },
      on_chunk_start: () => {
        if (partialText.length > 0) partialText += "\n";
      },
    });
    const output = await transcriber(audio, {
      language: "japanese",
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      streamer,
    });
    const text = Array.isArray(output) ? output.map((o) => o.text).join("\n") : output.text;
    const message: TranscribeWorkerMessage = { type: "result", text, elapsedMs: performance.now() - startedAt };
    self.postMessage(message);
  } catch (err) {
    const message: TranscribeWorkerMessage = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(message);
  }
};
