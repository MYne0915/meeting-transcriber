/**
 * Remembers meeting names / projects the user has typed before, entirely in this browser's
 * localStorage. Intentionally has no built-in presets: this app's source is public, and
 * hardcoding real meeting series / project codenames would leak internal company info into it.
 */

const MEETING_NAME_HISTORY_KEY = "meeting-transcriber:meeting-name-history";
const PROJECT_HISTORY_KEY = "meeting-transcriber:project-history";
const LAST_TAGS_KEY = "meeting-transcriber:last-tags";
const MAX_HISTORY = 20;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadMeetingNameHistory(): string[] {
  return loadJson<string[]>(MEETING_NAME_HISTORY_KEY, []);
}

export function rememberMeetingName(title: string): void {
  if (!title.trim()) return;
  const history = loadMeetingNameHistory().filter((entry) => entry !== title);
  history.unshift(title);
  localStorage.setItem(MEETING_NAME_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export function loadProjectHistory(): string[] {
  return loadJson<string[]>(PROJECT_HISTORY_KEY, []);
}

export function rememberProject(project: string): void {
  if (!project.trim()) return;
  const history = loadProjectHistory().filter((p) => p !== project);
  history.unshift(project);
  localStorage.setItem(PROJECT_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

/** Last-used tags string, so the field defaults to what this user typed last time instead of a hardcoded value. */
export function loadLastTags(): string {
  try {
    return localStorage.getItem(LAST_TAGS_KEY) ?? "meeting";
  } catch {
    return "meeting";
  }
}

export function rememberTags(tags: string): void {
  if (!tags.trim()) return;
  localStorage.setItem(LAST_TAGS_KEY, tags);
}
