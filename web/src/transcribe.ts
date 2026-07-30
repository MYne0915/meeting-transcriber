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

/** Decodes the recorded blob, then transcribes it in a Web Worker (off the UI thread). */
export async function transcribeAudio(
  blob: Blob,
  modelId: WhisperModelId,
  onProgress?: (p: TranscribeProgress) => void,
  onDevice?: (device: TranscribeDevice) => void,
): Promise<TranscribeResult> {
  const audio = await decodeToMono16k(blob);
  const worker = new Worker(new URL("./transcribe-worker.ts", import.meta.url), {
    type: "module",
  });

  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<TranscribeWorkerMessage>) => {
      const msg = event.data;
      if (msg.type === "device") {
        onDevice?.(msg.device);
      } else if (msg.type === "loading") {
        onProgress?.({ file: msg.file, progress: msg.progress });
      } else if (msg.type === "result") {
        worker.terminate();
        resolve({ text: msg.text, elapsedMs: msg.elapsedMs });
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ type: "transcribe", audio, modelId }, [audio.buffer]);
  });
}
