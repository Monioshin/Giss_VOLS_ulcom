/** Короткая подпись списка по длине и id (для пропуска лишних invalidate). */
export function listIdsSignature(list: { id: number }[]): string {
  if (list.length === 0) return '0'
  const sample = list.length <= 32 ? list : [...list.slice(0, 16), ...list.slice(-16)]
  return `${list.length}:${sample.map((x) => x.id).join(',')}`
}
