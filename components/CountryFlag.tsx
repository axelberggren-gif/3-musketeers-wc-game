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
      className={`${className ?? ""} rounded-md bg-[var(--surface-2)] flex items-center justify-center text-[var(--muted)] text-xs font-semibold`}
    >
      {code ?? name.slice(0, 3).toUpperCase()}
    </div>
  );
}
