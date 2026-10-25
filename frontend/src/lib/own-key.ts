/**
 * `obj[key]`, but only the object's OWN entry — never an inherited Object
 * member. Strip and badge lookups are keyed by codes, and under the All lens
 * those codes are TEAM codes, which are any `^[a-z][a-z0-9-]{1,31}$`: a team
 * coded "constructor" is valid, and a plain `cells["constructor"]` on a bar with
 * no badge for it returns `Object.prototype.constructor` — a phantom cell that
 * passes "has a cell" checks. (Check codes are upper-case and category strip
 * codes are prefixed, so neither can collide; this guards every code alike.)
 */
export function ownValue<T>(
  obj: Readonly<Record<string, T>> | null | undefined,
  key: string,
): T | undefined {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}
