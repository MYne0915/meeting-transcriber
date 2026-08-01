export interface TranscriptNoteOptions {
  /** YYYY-MM-DD */
  date: string;
  tags: string[];
  project?: string;
  meetingName?: string;
  transcript: string;
}

/**
 * Builds the intermediate note: frontmatter plus the raw transcript. Summarizing, correcting
 * proper nouns against past notes, and renaming to the Vault's filename convention are done
 * afterwards by Claude, so this file deliberately stops at the transcript.
 */
export function buildTranscriptNote(options: TranscriptNoteOptions): string {
  const { date, tags, project, meetingName, transcript } = options;

  const frontmatter = [
    "---",
    `date: ${date}`,
    `tags: [${tags.join(", ")}]`,
    `project: ${project ?? ""}`,
    "related: []",
    "---",
  ].join("\n");

  const title = meetingName ? `# 文字起こし: ${meetingName}` : "# 文字起こし";

  return `${frontmatter}\n\n${title}\n\n**日時**: ${date}\n\n${transcript.trim()}\n`;
}

/** Named as a transcript, not a finished note, so it is never mistaken for one in the Vault. */
export function transcriptFilename(date: string): string {
  return `${date}-transcript.md`;
}
