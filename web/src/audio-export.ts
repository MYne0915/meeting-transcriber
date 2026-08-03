/**
 * Zips recorded audio segments for download, without any third-party zip library.
 * The ZIP "store" (no compression) method is a small, well-specified binary format, and
 * store mode costs nothing here since the segments are already Opus-compressed audio.
 *
 * Segment bytes are only ever read one at a time (to compute a CRC) and are then handed to
 * the output Blob as Blobs, not copies, so a multi-hour recording never sits in memory twice.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Copies a view into a standalone ArrayBuffer, which is always a valid BlobPart. */
function toBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function dosDateTime(date: Date): { time: number; dosDate: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, dosDate };
}

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/** Builds a minimal, uncompressed (store method) ZIP archive. */
export async function buildZip(entries: ZipEntry[]): Promise<Blob> {
  const { time, dosDate } = dosDateTime(new Date());
  const localParts: BlobPart[] = [];
  const centralParts: ArrayBuffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = toBuffer(new TextEncoder().encode(entry.name));
    const crc = crc32(new Uint8Array(await entry.blob.arrayBuffer()));
    const size = entry.blob.size;

    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true);
    localHeader.setUint16(4, 20, true); // version needed
    localHeader.setUint16(6, 0, true); // flags
    localHeader.setUint16(8, 0, true); // method: store
    localHeader.setUint16(10, time, true);
    localHeader.setUint16(12, dosDate, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, size, true); // compressed size
    localHeader.setUint32(22, size, true); // uncompressed size
    localHeader.setUint16(26, nameBuffer.byteLength, true);
    localHeader.setUint16(28, 0, true); // extra length

    localParts.push(localHeader.buffer, nameBuffer, entry.blob);

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true);
    centralHeader.setUint16(4, 20, true); // version made by
    centralHeader.setUint16(6, 20, true); // version needed
    centralHeader.setUint16(8, 0, true); // flags
    centralHeader.setUint16(10, 0, true); // method: store
    centralHeader.setUint16(12, time, true);
    centralHeader.setUint16(14, dosDate, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, size, true);
    centralHeader.setUint32(24, size, true);
    centralHeader.setUint16(28, nameBuffer.byteLength, true);
    centralHeader.setUint16(30, 0, true); // extra length
    centralHeader.setUint16(32, 0, true); // comment length
    centralHeader.setUint16(34, 0, true); // disk number start
    centralHeader.setUint16(36, 0, true); // internal attrs
    centralHeader.setUint32(38, 0, true); // external attrs
    centralHeader.setUint32(42, offset, true); // local header offset

    centralParts.push(centralHeader.buffer, nameBuffer);

    offset += 30 + nameBuffer.byteLength + size;
  }

  const centralStart = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true); // disk number
  end.setUint16(6, 0, true); // disk with central dir
  end.setUint16(8, entries.length, true); // entries on this disk
  end.setUint16(10, entries.length, true); // total entries
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralStart, true);
  end.setUint16(20, 0, true); // comment length

  return new Blob([...localParts, ...centralParts, end.buffer], { type: "application/zip" });
}

/**
 * Travels with the audio so the meeting can be identified later. It is captured here, at
 * recording time, because that is when the person running the meeting actually knows what it
 * is — by the time the audio is transcribed on another machine, the context is gone.
 */
export interface RecordingMetadata {
  /** YYYY-MM-DD */
  date: string;
  meetingName?: string;
  project?: string;
  tags: string[];
}

/**
 * The mac CLI ([[archive.ts]]'s AUDIO_EXTENSIONS) identifies segment files by extension, so an
 * uploaded MP3/M4A/WAV must keep its real extension rather than being forced into .webm.
 */
const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};

export function extensionForMimeType(mimeType: string | undefined): string {
  if (!mimeType) return "webm";
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return MIME_EXTENSIONS[base] ?? "webm";
}

/** Preferred over MIME sniffing for uploaded files, since the browser's reported type can be empty. */
export function extensionFromFilename(name: string): string | undefined {
  const match = /\.([a-zA-Z0-9]+)$/.exec(name);
  return match?.[1]?.toLowerCase();
}

export async function downloadRecordingAsZip(
  segments: Blob[],
  metadata: RecordingMetadata,
  filename: string,
  segmentExtension: string,
): Promise<void> {
  const entries: ZipEntry[] = [
    { name: "meta.json", blob: new Blob([JSON.stringify(metadata, null, 2)]) },
    ...segments.map((blob, i) => ({
      name: `segment-${(i + 1).toString().padStart(2, "0")}.${segmentExtension}`,
      blob,
    })),
  ];
  const zip = await buildZip(entries);
  const url = URL.createObjectURL(zip);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
