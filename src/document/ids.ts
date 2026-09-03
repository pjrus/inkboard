/** Short random ids for boards and canvas objects. */
export function newId(length = 12): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}
