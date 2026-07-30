export interface ExportOptions {
  /** YYYY-MM-DD */
  date: string;
  tags: string[];
  project?: string;
  /** Japanese meeting name (e.g. "回路定例"). If set, overrides/fills the "# 議事録: <title>" line. */
  meetingName?: string;
  /** LLM-generated (or manually written) body starting with "# 議事録: <title>" */
  summaryMarkdown: string;
}

/** Builds the full note contents: YAML frontmatter + "# 議事録: ..." body with a **日時** line inserted. */
export function buildMeetingMinutesMarkdown(options: ExportOptions): string {
  const { date, tags, project, meetingName, summaryMarkdown } = options;

  const frontmatter = [
    "---",
    `date: ${date}`,
    `tags: [${tags.join(", ")}]`,
    `project: ${project ?? ""}`,
    "related: []",
    "---",
    "",
  ].join("\n");

  const lines = summaryMarkdown.trimStart().split("\n");
  const titleLineIndex = lines.findIndex((line) => line.startsWith("# "));
  if (meetingName) {
    const titleLine = `# 議事録: ${meetingName}`;
    if (titleLineIndex !== -1) {
      lines[titleLineIndex] = titleLine;
    } else {
      lines.unshift(titleLine, "");
    }
  }
  const resolvedTitleLineIndex = lines.findIndex((line) => line.startsWith("# "));
  if (resolvedTitleLineIndex !== -1 && !lines.some((line) => line.startsWith("**日時**"))) {
    lines.splice(resolvedTitleLineIndex + 1, 0, "", `**日時**: ${date}`);
  }
  const body = lines.join("\n").trimEnd();

  return `${frontmatter}\n${body}\n`;
}

/** Matches the existing Vault convention: YYYY-MM-DD-topic-meeting-minutes.md */
export function suggestFilename(date: string, topicSlug: string): string {
  const safeSlug =
    topicSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "meeting";
  return `${date}-${safeSlug}-meeting-minutes.md`;
}

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
