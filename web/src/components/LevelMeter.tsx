import { useEffect, useRef, useState } from "react";

interface Props {
  analyser: AnalyserNode | null;
  active: boolean;
}

/**
 * RMS below this reads as silence rather than quiet speech. Chosen well above digital-zero
 * noise floor but well below even soft speech, so a genuinely dead mic/system feed (the failure
 * this meter exists to catch — recorded 38 minutes of near-silence undetected until after
 * transcription, see recording-audio-level-indicator) reads visibly differently from audio
 * that's just quiet.
 */
const SILENCE_THRESHOLD = 0.02;

/** Speech RMS rarely exceeds ~0.3, so the bar is scaled up for a visually useful range. */
const METER_GAIN = 3;

/** Live level meter for the exact signal being recorded (see CaptureSession.analyser). */
export function LevelMeter({ analyser, active }: Props) {
  const [level, setLevel] = useState(0);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!analyser || !active) {
      setLevel(0);
      return;
    }

    const data = new Uint8Array(analyser.fftSize);
    function tick() {
      analyser!.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      setLevel(Math.sqrt(sumSquares / data.length));
      frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [analyser, active]);

  if (!active) return null;

  const silent = level < SILENCE_THRESHOLD;
  const percent = Math.min(100, Math.round(level * METER_GAIN * 100));

  return (
    <div className="level-meter">
      <div className="level-meter-track">
        <div className={`level-meter-fill${silent ? " silent" : ""}`} style={{ width: `${percent}%` }} />
      </div>
      <span className={`level-meter-label${silent ? " silent" : ""}`}>{silent ? "無音" : "音声あり"}</span>
    </div>
  );
}
