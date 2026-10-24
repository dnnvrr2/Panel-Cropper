export interface UndoEntry<T> {
  snapshot: T;
  group: string | null;
  recordedAt: number;
}

export function pushUndoEntry<T>(entries: UndoEntry<T>[], snapshot: T, group: string | null,
  now = Date.now(), limit = 100): UndoEntry<T>[] {
  const last = entries.at(-1);
  if (group && last?.group === group && now - last.recordedAt < 750) {
    return [...entries.slice(0, -1), { ...last, recordedAt: now }];
  }
  return [...entries.slice(-(limit - 1)), { snapshot, group, recordedAt: now }];
}
