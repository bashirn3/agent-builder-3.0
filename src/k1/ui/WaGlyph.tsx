// WhatsApp's own glyphs for link, copy-code and quick-reply buttons.
export function WaGlyph({ kind }: { kind: 'link' | 'copy' | 'reply' }) {
  const shared = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  if (kind === 'link') {
    return <svg {...shared}><path d="M14 5h5v5" /><path d="M19 5 10 14" /><path d="M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5" /></svg>
  }
  if (kind === 'copy') {
    return <svg {...shared}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" /></svg>
  }
  return <svg {...shared}><path d="M9 14 4 9l5-5" /><path d="M4 9h9a7 7 0 0 1 7 7v3" /></svg>
}
