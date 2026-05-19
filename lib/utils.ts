import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isoToLocal(iso: string | Date, opts?: Intl.DateTimeFormatOptions) {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(date);
}

export function randomToken(length = 16) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

// PostgREST returns embedded foreign-key relations as either a single object or
// a one-element array depending on how it infers cardinality. Until db:types is
// regenerated against a live schema, every call site has to handle both.
export function unwrapRelation<T>(r: T | T[] | null | undefined): T | null {
  if (Array.isArray(r)) return r[0] ?? null;
  return r ?? null;
}
