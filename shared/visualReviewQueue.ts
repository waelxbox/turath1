/** Prefer the next remaining item, wrapping only at the end of the queue. */
export function nextReviewRecord(queue: Array<{ id: string }>, currentId: string, remaining: Array<{ id: string }>) {
  const available = new Set(remaining.map(item => item.id));
  available.delete(currentId);
  const position = queue.findIndex(item => item.id === currentId);
  const ordered = position < 0 ? queue : [...queue.slice(position + 1), ...queue.slice(0, position)];
  return ordered.find(item => available.has(item.id))?.id ?? remaining.find(item => available.has(item.id))?.id;
}
