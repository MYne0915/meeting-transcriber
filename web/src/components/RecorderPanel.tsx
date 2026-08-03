import { useState } from "react";
import type { CaptureOptions } from "../audio-capture";

interface Props {
  recording: boolean;
  elapsedLabel: string;
  onStart: (options: CaptureOptions) => void;
  onStop: () => void;
}

export function RecorderPanel({ recording, elapsedLabel, onStart, onStop }: Props) {
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [includeMic, setIncludeMic] = useState(true);

  return (
    <>
      <label className="field checkbox">
        <input
          type="checkbox"
          checked={includeSystemAudio}
          disabled={recording}
          onChange={(e) => setIncludeSystemAudio(e.target.checked)}
        />
        PCのシステム音声(Web会議の相手の声など)
      </label>
      <label className="field checkbox">
        <input
          type="checkbox"
          checked={includeMic}
          disabled={recording}
          onChange={(e) => setIncludeMic(e.target.checked)}
        />
        マイク(自分の声)
      </label>

      {includeSystemAudio && !recording && (
        <p className="hint">
          開始すると画面共有の許可ダイアログが出ます。「画面全体」を選び、「音声を共有」にチェックを入れてください。
        </p>
      )}

      <div className="row">
        {!recording ? (
          <button
            type="button"
            className="primary"
            disabled={!includeSystemAudio && !includeMic}
            onClick={() => onStart({ includeSystemAudio, includeMic })}
          >
            録音開始
          </button>
        ) : (
          <button type="button" className="danger" onClick={onStop}>
            録音停止({elapsedLabel})
          </button>
        )}
      </div>
    </>
  );
}
