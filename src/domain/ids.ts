/** Small id helper: time-ordered, collision-resistant enough for one phone. No crypto dependency. */
export function newId(prefix: string, now: number = Date.now()): string {
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(5, '0');
  return `${prefix}_${now.toString(36)}${rand}`;
}
