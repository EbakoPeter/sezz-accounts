/**
 * A small, original mark — a navy medallion with a gold ring and a
 * simple "N" motif — rather than a photographic or borrowed image.
 * Kept deliberately abstract and simple: legible at the small sizes
 * this actually renders at (the header, the login screen), and free of
 * any resemblance to an existing brand's own mark.
 */
export function Logo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Logo NKaP">
      <circle cx="50" cy="50" r="46" fill="#0D1B2A" stroke="#C98A3B" strokeWidth="5" />
      <path
        d="M32,68 L32,32 L68,68 L68,32"
        stroke="#C98A3B"
        strokeWidth="8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
