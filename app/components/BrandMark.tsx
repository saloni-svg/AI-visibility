// RyzeIQ logo: a rising line that ends in a spark (rise + insight) on a cobalt-to-cyan tile,
// and the wordmark with "IQ" in the brand gradient.
export function RyzeMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="rz-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="rz-tile" x1="2" y1="30" x2="30" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1A2B8F" />
          <stop offset="0.5" stopColor="#2F5BFF" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#rz-tile)" />
      <path d="M7 23.5 12.6 17.6l3.6 3.4 6.3-6.6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23.6 5.6c.4 2.1 1.1 2.8 3.2 3.2-2.1.4-2.8 1.1-3.2 3.2-.4-2.1-1.1-2.8-3.2-3.2 2.1-.4 2.8-1.1 3.2-3.2Z" fill="#CFFAFE" />
    </svg>
  );
}

export default function BrandLockup({ tag = "Search & AI visibility" }: { tag?: string }) {
  return (
    <div className="brand-lockup rz-lockup">
      <RyzeMark />
      <div>
        <div className="brand-name rz-name">Ryze<span>IQ</span></div>
        {tag && <div className="brand-tag">{tag}</div>}
      </div>
    </div>
  );
}
