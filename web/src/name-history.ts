/**
 * Remembers meeting names / projects the user has typed before, entirely in this browser's
 * localStorage. Intentionally has no built-in presets: this app's source is public, and
 * hardcoding real meeting series / project codenames would leak internal company info into it.
 */

const MEETING_NAME_HISTORY_KEY = "meeting-transcriber:meeting-name-history";
const PROJECT_HISTORY_KEY = "meeting-transcriber:project-history";
const MAX_HISTORY = 20;

export interface MeetingNameEntry {
  title: string;
  slug: string;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadMeetingNameHistory(): MeetingNameEntry[] {
  return loadJson<MeetingNameEntry[]>(MEETING_NAME_HISTORY_KEY, []);
}

export function rememberMeetingName(title: string, slug: string): void {
  if (!title.trim()) return;
  const history = loadMeetingNameHistory().filter((entry) => entry.title !== title);
  history.unshift({ title, slug });
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
