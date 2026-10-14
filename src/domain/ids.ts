/**
 * Local ids for the records the phone creates itself: check-ins ('ci'), focus sessions ('s'), session goals
 * ('g') and free blocks ('b'). There are no accounts and no server that hands ids out, so the phone mints them.
 */

/**
 * Small id helper: time-ordered, collision-resistant enough for one phone. No crypto dependency.
 * Shape: `${prefix}_` + `now` in base 36 + 5 random base-36 characters, so ids with one prefix sort by
 * creation time. A check-in's id is also sent with its report so the relay can ignore a re-sent
 * earlier-visit report; the relay holds it only in a 3-hour seen set and never stores it with the report.
 */
export function newId(prefix: string, now: number = Date.now()): string {
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(5, '0');
  return `${prefix}_${now.toString(36)}${rand}`;
}
