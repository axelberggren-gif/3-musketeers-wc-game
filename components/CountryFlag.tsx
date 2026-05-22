import Image from "next/image";

interface Props {
  crestUrl: string | null | undefined;
  code: string | null | undefined;
  name: string;
  size?: number;
  className?: string;
}

export function CountryFlag({ crestUrl, code, name, size = 48, className }: Props) {
  if (crestUrl) {
    return (
      <Image
        src={crestUrl}
        alt={`${name} crest`}
        width={size}
        height={size}
        unoptimized
        className={className}
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className={`${className ?? ""} rounded-md bg-paper-2 border-2 border-ink flex items-center justify-center text-ink text-xs font-display tracking-wider`}
    >
      {code ?? name.slice(0, 3).toUpperCase()}
    </div>
  );
}

/**
 * Convert an ISO-3166-1 alpha-2 country code into the matching regional-indicator
 * emoji flag. Returns null for codes that don't decode to two letters (e.g. the
 * football-data three-letter codes like "ENG"). Used for decorative sticker stacks
 * on the landing page where we don't have crest URLs.
 */
export function codeToEmojiFlag(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  if (trimmed.length !== 2 || !/^[A-Z]{2}$/.test(trimmed)) return null;
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + (trimmed.charCodeAt(0) - 65),
    base + (trimmed.charCodeAt(1) - 65),
  );
}
