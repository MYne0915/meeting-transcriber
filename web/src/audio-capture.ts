export interface CaptureOptions {
  includeMic: boolean;
  includeSystemAudio: boolean;
  /**
   * Recording is split into segments of this length so a long meeting never needs a single
   * huge decode/transcribe pass (decoding a multi-hour blob in one go can use several GB of
   * RAM and crash the tab). Default 10 minutes.
   */
  segmentSeconds?: number;
}

export interface CaptureSession {
  /** Stops all tracks and the recorder, returns each recorded segment as an independent Blob. */
  stop: () => Promise<Blob[]>;
  /** The MIME type MediaRecorder actually used, so the exporter can pick a matching file extension. */
  mimeType: string | undefined;
  /**
   * Taps the exact mixed signal being recorded, so the UI can show a live level meter. A dead
   * mic or missing system-audio permission then reads as a flat meter during recording instead
   * of only being discovered after transcription (see recording-audio-level-indicator).
   */
  analyser: AnalyserNode;
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
  // The analyser sits between the sources and the recording destination (not a side branch),
  // so what it measures is exactly the mixed signal that ends up in the recorded file.
  const analyser = audioContext.createAnalyser();
  analyser.connect(destination);
  rawStreams.forEach((stream) => {
    audioContext.createMediaStreamSource(stream).connect(analyser);
  });

  const mimeType = pickMimeType();
  const segmentSeconds = options.segmentSeconds ?? 600;
  const segments: Blob[] = [];
  let chunks: BlobPart[] = [];
  let recorder: MediaRecorder;
  let stopping = false;

  function finalizeSegment(): void {
    if (chunks.length === 0) return;
    segments.push(new Blob(chunks, { type: mimeType ?? "audio/webm" }));
    chunks = [];
  }

  function waitForStop(rec: MediaRecorder): Promise<void> {
    return new Promise((resolve) => {
      rec.onstop = () => resolve();
    });
  }

  function startRecorder(): void {
    recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(1000);
  }

  startRecorder();

  // Every segmentSeconds, stop the recorder (finalizing a standalone, independently
  // decodable WebM file for that segment) and immediately start a fresh one on the same
  // stream. This causes a brief (sub-second) gap in the recording at each rotation.
  const rotateTimer = setInterval(() => {
    if (stopping) return;
    void (async () => {
      const finishedRecorder = recorder;
      const stopped = waitForStop(finishedRecorder);
      finishedRecorder.stop();
      await stopped;
      finalizeSegment();
      if (!stopping) startRecorder();
    })();
  }, segmentSeconds * 1000);

  const stop = async (): Promise<Blob[]> => {
    stopping = true;
    clearInterval(rotateTimer);
    const stopped = waitForStop(recorder);
    recorder.stop();
    await stopped;
    finalizeSegment();
    rawStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    await audioContext.close();
    return segments;
  };

  return { stop, mimeType, analyser };
}
