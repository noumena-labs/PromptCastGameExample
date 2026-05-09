/**
 * Small SVG corner ornament used on tome panels, modals, and other parchment
 * containers to anchor the four corners with a gilt curl. Position controls
 * which corner via CSS — the SVG is reflected/rotated by `.tomeCorner.*`
 * class rules in `globals.css`.
 */
export function CornerFlourish({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  return (
    <svg className={`tomeCorner ${position}`} viewBox="0 0 64 64" fill="none" aria-hidden>
      <path d="M0 32C0 14 14 0 32 0" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 32C8 18 18 8 32 8" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <circle cx="14" cy="14" r="3" fill="currentColor" opacity="0.7" />
    </svg>
  );
}
