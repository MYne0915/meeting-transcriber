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

function remember(key: string, value: string): void {
  if (!value.trim()) return;
  const history = loadJson<string[]>(key, []).filter((entry) => entry !== value);
  history.unshift(value);
  localStorage.setItem(key, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export function loadMeetingNameHistory(): string[] {
  return loadJson<string[]>(MEETING_NAME_HISTORY_KEY, []);
}

export function rememberMeetingName(title: string): void {
  remember(MEETING_NAME_HISTORY_KEY, title);
}

export function loadProjectHistory(): string[] {
  return loadJson<string[]>(PROJECT_HISTORY_KEY, []);
}

export function rememberProject(project: string): void {
  remember(PROJECT_HISTORY_KEY, project);
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
