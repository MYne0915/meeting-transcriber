import type { TranscribeDevice, TranscribeWorkerMessage, WhisperModelId } from "./transcribe-worker";

export type { TranscribeDevice };

export interface TranscribeProgress {
  file: string;
  progress: number;
}

export interface TranscribeResult {
  text: string;
  elapsedMs: number;
}

async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  const decoded = await audioContext.decodeAudioData(arrayBuffer);
  await audioContext.close();

  const targetSampleRate = 16000;
  const offlineContext = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * targetSampleRate),
    targetSampleRate,
  );
  const source = offlineContext.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineContext.destination);
  source.start();
  const rendered = await offlineContext.startRendering();
  return rendered.getChannelData(0);
}

export interface TranscribeSession {
  /**
   * Decodes one segment blob and transcribes it using the session's Worker. The Worker (and
   * its loaded model) is reused across segments, so only the first segment pays the model
   * load/init cost.
   */
  transcribeSegment: (
    blob: Blob,
    onProgress?: (p: TranscribeProgress) => void,
    onDevice?: (device: TranscribeDevice) => void,
    onPartial?: (text: string) => void,
  ) => Promise<TranscribeResult>;
  terminate: () => void;
}

/** Creates a Worker that stays alive across multiple transcribeSegment() calls. */
export function createTranscribeSession(modelId: WhisperModelId, forceWasm: boolean): TranscribeSession {
  const worker = new Worker(new URL("./transcribe-worker.ts", import.meta.url), {
    type: "module",
  });

  async function transcribeSegment(
    blob: Blob,
    onProgress?: (p: TranscribeProgress) => void,
    onDevice?: (device: TranscribeDevice) => void,
    onPartial?: (text: string) => void,
  ): Promise<TranscribeResult> {
    const audio = await decodeToMono16k(blob);

    return new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<TranscribeWorkerMessage>) => {
        const msg = event.data;
        if (msg.type === "device") {
          onDevice?.(msg.device);
        } else if (msg.type === "loading") {
          onProgress?.({ file: msg.file, progress: msg.progress });
        } else if (msg.type === "partial") {
          onPartial?.(msg.text);
        } else if (msg.type === "result") {
          resolve({ text: msg.text, elapsedMs: msg.elapsedMs });
        } else if (msg.type === "error") {
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (event) => {
        reject(new Error(event.message));
      };
      worker.postMessage({ type: "transcribe", audio, modelId, forceWasm }, [audio.buffer]);
    });
  }

  return { transcribeSegment, terminate: () => worker.terminate() };
}
