/** Tiny className joiner — filters out falsy values. Avoids pulling in clsx for a one-liner. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
