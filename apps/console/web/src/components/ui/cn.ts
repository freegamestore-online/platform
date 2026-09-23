/** Tiny classname combiner — filters falsy values and joins. Avoids a clsx
 *  dependency for the few conditional classes the primitives need. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
