// Hand-drawn "Ask the book" launchers, one per skin. Static SVG, no fetches.
// Gradient and filter ids carry an ask- prefix; only one launcher mounts.

export function AskPencil() {
  return (
    <svg viewBox="0 0 236 80" width={236} height={80} aria-hidden="true" focusable="false">
      <defs>
      <filter id="ask-pR"><feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="2" seed="2"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter>
      <filter id="ask-pG"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="5" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.4 1.2" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>
      <pattern id="ask-pH" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-48)"><path d="M0 1H5" stroke="#4a4a4a" strokeWidth=".7"/></pattern>
      <radialGradient id="ask-pE" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#8a8a8a" stopOpacity=".22"/><stop offset="1" stopColor="#8a8a8a" stopOpacity="0"/></radialGradient></defs>
      <g className="a-lift">
      <ellipse cx="176" cy="60" rx="46" ry="13" fill="url(#ask-pE)" transform="rotate(-4 176 60)"/>
      <g filter="url(#ask-pR)"><path d="M18 20 Q118 13 214 19 L218 58 Q120 64 20 60Z" fill="#fbfaf6"/>
      <path d="M22 56 L58 59 L24 30Z" fill="url(#ask-pH)" opacity=".55"/><path d="M190 22 L214 20 L216 44Z" fill="url(#ask-pH)" opacity=".4"/></g>
      <g filter="url(#ask-pG)" fill="none" stroke="#2b2b2b" strokeLinecap="round"><path d="M14 21 Q116 12 216 18 L220 59 Q118 66 18 61 Z" strokeWidth="1.6" filter="url(#ask-pR)"/>
      <path d="M20 18 Q120 15 212 21 M216 22 L216 60 M214 62 Q110 61 22 63 M17 58 L16 24" strokeWidth=".9" opacity=".7"/>
      <path d="M44 62l-6 9M54 62l-6 9M64 62l-6 9" strokeWidth=".8" opacity=".6"/></g>
      <g transform="translate(38 40) rotate(-35)"><path d="M-16 -4h26l8 4-8 4h-26z" fill="#e7c35a" stroke="#2b2b2b" strokeWidth="1"/><path d="M10 -4l8 4-8 4z" fill="#f3dfb8" stroke="#2b2b2b" strokeWidth=".8"/><path d="M15.5 -1.3l2.5 1.3-2.5 1.3z" fill="#2b2b2b"/><rect x="-22" y="-4" width="6" height="8" fill="#e59a9a" stroke="#2b2b2b" strokeWidth=".8"/></g>
      <text x="132" y="48" textAnchor="middle" fontFamily="Kalam, cursive" fontWeight="700" fontSize="22" fill="#262626" opacity=".92">Ask the book</text>
      <path d="M78 53 Q130 57 186 52" stroke="#2b2b2b" strokeWidth="1.1" fill="none" filter="url(#ask-pR)" opacity=".75"/>
      </g>
    </svg>
  );
}

export function AskComic() {
  return (
    <svg viewBox="0 0 236 86" width={236} height={86} aria-hidden="true" focusable="false">
      <defs>
      <pattern id="ask-cH" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="3" cy="3" r="1.25" fill="#e8b400"/></pattern></defs>
      <g className="a-lift" transform="rotate(-3 118 43)">
      <path d="M30 12h170c12 0 20 8 20 18v18c0 10-8 18-20 18H72l-26 16 6-16H30c-12 0-20-8-20-18V30c0-10 8-18 20-18z" fill="#1b1f2a" transform="translate(5 5)"/>
      <path d="M30 12h170c12 0 20 8 20 18v18c0 10-8 18-20 18H72l-26 16 6-16H30c-12 0-20-8-20-18V30c0-10 8-18 20-18z" fill="#ffe45c" stroke="#1b1f2a" strokeWidth="3.2" strokeLinejoin="round"/>
      <path d="M30 12h170c12 0 20 8 20 18v18c0 10-8 18-20 18H72l-26 16 6-16H30c-12 0-20-8-20-18V30c0-10 8-18 20-18z" fill="url(#ask-cH)" opacity=".8" style={{ clipPath: "inset(50% 0 0 0)" }}/>
      <path d="M24 22c3-5 8-7 14-7" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <text x="117" y="47" textAnchor="middle" fontFamily="Instrument Sans, Arial Black, sans-serif" fontWeight="900" fontSize="20" letterSpacing=".5" fill="#1b1f2a" stroke="#fff" strokeWidth="4" paintOrder="stroke">ASK THE BOOK!</text>
      <g fill="#e8463a" stroke="#1b1f2a" strokeWidth="1.4"><path d="M222 6l3 8 7-4-4 7 8 3-8 2 3 7-7-4-3 8-2-8-8 2 5-6-6-5 8-1-1-8z"/></g>
      </g>
    </svg>
  );
}

export function AskLantern() {
  return (
    <svg viewBox="0 0 236 84" width={236} height={84} aria-hidden="true" focusable="false">
      <defs>
      <radialGradient id="ask-hG" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#ffcf6b" stopOpacity=".75"/><stop offset=".5" stopColor="#ff9a3c" stopOpacity=".25"/><stop offset="1" stopColor="#ff7a2a" stopOpacity="0"/></radialGradient>
      <radialGradient id="ask-hL" cx=".45" cy=".4" r=".65"><stop offset="0" stopColor="#ffe9a8"/><stop offset=".45" stopColor="#ff9f45"/><stop offset="1" stopColor="#c8401e"/></radialGradient>
      <linearGradient id="ask-hT" x1="0" x2="1"><stop offset="0" stopColor="#c9a227" stopOpacity="0"/><stop offset=".15" stopColor="#e9c46a"/><stop offset=".85" stopColor="#e9c46a"/><stop offset="1" stopColor="#c9a227" stopOpacity="0"/></linearGradient></defs>
      <g className="a-lift">
      <ellipse className="a-glow" cx="40" cy="44" rx="40" ry="40" fill="url(#ask-hG)"/>
      <path d="M40 2v8" stroke="#3a2416" strokeWidth="1.4"/>
      <rect x="31" y="10" width="18" height="6" rx="1.5" fill="#2b1a10" stroke="#c9a227" strokeWidth="1"/>
      <path d="M40 16c-16 0-22 12-22 26s6 26 22 26 22-12 22-26-6-26-22-26z" fill="url(#ask-hL)" stroke="#7a2a14" strokeWidth="1.2"/>
      <path d="M40 16c-8 4-11 14-11 26s3 22 11 26M40 16c8 4 11 14 11 26s-3 22-11 26M40 16v52" fill="none" stroke="#8a3418" strokeWidth=".8" opacity=".55"/>
      <path d="M19 30h42M18 42h44M19 54h42" stroke="#8a3418" strokeWidth=".7" opacity=".45"/>
      <text x="40" y="49" textAnchor="middle" fontFamily="serif" fontWeight="700" fontSize="16" fill="#5a1a0c" opacity=".8">書</text>
      <rect x="31" y="68" width="18" height="6" rx="1.5" fill="#2b1a10" stroke="#c9a227" strokeWidth="1"/>
      <path d="M40 74v6M37 80h6" stroke="#c9a227" strokeWidth="1.4"/><path d="M38 80l-1 4M40 80v4M42 80l1 4" stroke="#d8432a" strokeWidth="1.2"/>
      <path d="M74 52h150" stroke="url(#ask-hT)" strokeWidth="1"/>
      <text x="148" y="45" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontStyle="italic" fontWeight="600" fontSize="26" fill="#7a2414" stroke="#fff3df" strokeWidth="4" paintOrder="stroke">Ask the book</text>
      <circle cx="214" cy="26" r="1.6" fill="#ffd27a"/><circle cx="226" cy="36" r="1" fill="#ffd27a"/><circle cx="84" cy="22" r="1.2" fill="#ffd27a"/>
      </g>
    </svg>
  );
}
