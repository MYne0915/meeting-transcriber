export interface CaptureOptions {
  includeMic: boolean;
  includeSystemAudio: boolean;
}

export interface CaptureSession {
  /** Stops all tracks and the recorder, returns the recorded audio as a single Blob. */
  stop: () => Promise<Blob>;
}

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  return RECORDER_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Captures system audio (via getDisplayMedia, screen-share "Entire screen" required on
 * Windows for loopback audio) and/or microphone audio, mixes them into a single stream,
 * and records it. video:true is required by getDisplayMedia even though we only want
 * audio, so the video track is stopped immediately after acquisition.
 */
export async function startCapture(options: CaptureOptions): Promise<CaptureSession> {
  if (!options.includeMic && !options.includeSystemAudio) {
    throw new Error("マイクかシステム音声のどちらかは選択してください");
  }

  const rawStreams: MediaStream[] = [];

  if (options.includeSystemAudio) {
    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { systemAudio: "include" } as MediaTrackConstraints,
      });
    } catch (err) {
      throw new Error(
        "システム音声の共有が許可されませんでした。共有ダイアログで「画面全体」を選び、" +
          "音声共有を有効にしてください。",
      );
    }
    displayStream.getVideoTracks().forEach((track) => track.stop());
    if (displayStream.getAudioTracks().length === 0) {
      throw new Error(
        "システム音声を取得できませんでした。画面共有で「画面全体」を選び、" +
          "「音声を共有」にチェックを入れてください。",
      );
    }
    rawStreams.push(displayStream);
  }

  if (options.includeMic) {
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    rawStreams.push(micStream);
  }

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  rawStreams.forEach((stream) => {
    audioContext.createMediaStreamSource(stream).connect(destination);
  });

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const recordingStopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(1000);

  const stop = async (): Promise<Blob> => {
    recorder.stop();
    await recordingStopped;
    rawStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    await audioContext.close();
    return new Blob(chunks, { type: mimeType ?? "audio/webm" });
  };

  return { stop };
}
