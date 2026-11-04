// Hand-drawn "Ask the book" launchers, one per skin. Static SVG, no fetches.
// Gradient and filter ids carry an ask- prefix; only one launcher mounts.

export function AskEngraving() {
  return (
    <svg viewBox="0 0 236 78" width={236} height={78} aria-hidden="true" focusable="false">
      <defs>
      <pattern id="ask-eX" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><path d="M0 .6H3.2" stroke="#2a241c" strokeWidth=".55"/></pattern>
      <pattern id="ask-eX2" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)"><path d="M0 .6H3.2" stroke="#2a241c" strokeWidth=".45"/></pattern>
      <linearGradient id="ask-eP" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f6eed6"/><stop offset="1" stopColor="#e6d8b4"/></linearGradient></defs>
      <g className="a-lift">
      <path d="M30 10h176c0 7 6 11 12 11v36c-6 0-12 4-12 11H30c0-7-6-11-12-11V21c6 0 12-4 12-11z" fill="url(#ask-eP)" stroke="#2a241c" strokeWidth="1.6"/>
      <path d="M30 10h176c0 7 6 11 12 11v36c-6 0-12 4-12 11H30c0-7-6-11-12-11V21c6 0 12-4 12-11z" fill="url(#ask-eX)" opacity=".16"/>
      <path d="M35 15h166c1.5 5 5 8.5 12 9.5v29c-7 1-10.5 4.5-12 9.5H35c-1.5-5-5-8.5-12-9.5v-29c7-1 10.5-4.5 12-9.5z" fill="none" stroke="#2a241c" strokeWidth=".7"/>
      <g transform="translate(46 39)"><circle r="17" fill="#efe6ce" stroke="#2a241c" strokeWidth="1.2"/><circle r="17" fill="url(#ask-eX)" opacity=".55"/><circle r="17" fill="url(#ask-eX2)" opacity=".35"/><circle r="13.5" fill="#f6eed6" stroke="#2a241c" strokeWidth=".6"/>
      <path d="M-9 -4c3-2 6-2 9 0v11c-3-2-6-2-9 0zM9 -4c-3-2-6-2-9 0v11c3-2 6-2 9 0z" fill="#f6eed6" stroke="#2a241c" strokeWidth="1"/><path d="M-7 -1.5h5M-7 1h5M2 -1.5h5M2 1h5" stroke="#2a241c" strokeWidth=".45"/>
      <path d="M0 -12.5l1.2 2.6 2.8.3-2.1 1.9.6 2.8L0 -6.3l-2.5 1.4.6-2.8-2.1-1.9 2.8-.3z" fill="#2a241c"/></g>
      <text x="138" y="43" textAnchor="middle" fontFamily="IM Fell English SC, Georgia, serif" fontSize="19" letterSpacing="1.6" fill="#2a241c">Ask the Book</text>
      <path d="M84 54h40m10 0h40" stroke="#2a241c" strokeWidth=".8"/><path d="M129 50.5l3.5 3.5-3.5 3.5-3.5-3.5z" fill="#2a241c"/><path d="M84 23h90" stroke="#2a241c" strokeWidth=".5"/>
      <path d="M18 21c-6-4-12 0-9 6 2 4 7 2 6-1M18 57c-6 4-12 0-9-6 2-4 7-2 6 1M218 21c6-4 12 0 9 6-2 4-7 2-6-1M218 57c6 4 12 0 9-6-2-4-7-2-6 1" fill="none" stroke="#2a241c" strokeWidth="1.1"/>
      </g>
    </svg>
  );
}

export function AskWatercolor() {
  return (
    <svg viewBox="0 0 236 80" width={236} height={80} aria-hidden="true" focusable="false">
      <defs>
      <filter id="ask-wB" x="-10%" y="-20%" width="120%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="13"/><feGaussianBlur stdDeviation=".9"/></filter>
      <filter id="ask-wE" x="-10%" y="-20%" width="120%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="9"/></filter>
      <radialGradient id="ask-wG" cx=".3" cy=".35" r=".8"><stop offset="0" stopColor="#cfe2ff"/><stop offset=".55" stopColor="#8fbaf5"/><stop offset="1" stopColor="#5f95e6"/></radialGradient>
      <radialGradient id="ask-wP" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#f7b8a8" stopOpacity=".8"/><stop offset="1" stopColor="#f7b8a8" stopOpacity="0"/></radialGradient></defs>
      <g className="a-lift">
      <g filter="url(#ask-wB)"><path d="M22 40c-2-17 24-27 62-28 46-1 92 1 120 8 22 6 22 30 2 38-32 11-92 12-140 8-32-3-42-12-44-26z" fill="url(#ask-wG)" opacity=".85"/>
      <path d="M40 30c30-9 100-10 150-2" stroke="#fff" strokeOpacity=".5" strokeWidth="6" fill="none" strokeLinecap="round"/></g>
      <path d="M22 40c-2-17 24-27 62-28 46-1 92 1 120 8 22 6 22 30 2 38-32 11-92 12-140 8-32-3-42-12-44-26z" fill="none" stroke="#3f74c9" strokeWidth="2.2" opacity=".45" filter="url(#ask-wE)"/>
      <ellipse cx="200" cy="58" rx="18" ry="10" fill="url(#ask-wP)" opacity=".6"/><circle cx="214" cy="18" r="3" fill="#7fb0f5" opacity=".6" filter="url(#ask-wE)"/><circle cx="222" cy="27" r="1.6" fill="#7fb0f5" opacity=".5"/>
      <g transform="translate(28 66) rotate(-52)"><path d="M0 0C6-8 22-14 44-13 34-6 20 1 0 0z" fill="#fffdf8" stroke="#1f2a44" strokeWidth="1.1"/><path d="M0 0L40-12M10-3l4-6M18-6l5-6M26-8l5-5" stroke="#1f2a44" strokeWidth=".7" fill="none"/><path d="M0 0l-6 3" stroke="#1f2a44" strokeWidth="1.6" strokeLinecap="round"/></g>
      <text x="126" y="47" textAnchor="middle" fontFamily="Lora, Georgia, serif" fontStyle="italic" fontWeight="600" fontSize="21" fill="#1f2a44">Ask the book</text>
      </g>
    </svg>
  );
}

export function AskInk() {
  return (
    <svg viewBox="0 0 236 80" width={236} height={80} aria-hidden="true" focusable="false">
      <defs>
      <filter id="ask-iR" x="-5%" y="-30%" width="110%" height="160%"><feTurbulence type="fractalNoise" baseFrequency=".9 .06" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="7"/></filter>
      <filter id="ask-iS"><feTurbulence baseFrequency=".6" numOctaves="2" seed="9"/><feDisplacementMap in="SourceGraphic" scale="2.4"/></filter></defs>
      <g className="a-lift">
      <path d="M14 44c10-14 46-20 96-21s88 0 108 6c5 2 4 7-2 9-20 9-70 13-120 13S22 54 14 44z" fill="#1b1f2a" filter="url(#ask-iR)"/>
      <path d="M200 31c10 1 20 3 22 6" stroke="#1b1f2a" strokeWidth="2" fill="none" filter="url(#ask-iR)" opacity=".7"/>
      <path d="M30 48c40 3 120 3 170-4" stroke="#fffef9" strokeOpacity=".18" strokeWidth="2" fill="none"/>
      <text x="104" y="45" textAnchor="middle" fontFamily="Caveat, cursive" fontWeight="700" fontSize="27" fill="#fffef9">Ask the book</text>
      <g transform="translate(206 52) rotate(6)" filter="url(#ask-iS)"><rect x="-14" y="-14" width="28" height="28" rx="3" fill="#c8372d"/><rect x="-11" y="-11" width="22" height="22" rx="1.5" fill="none" stroke="#fffef9" strokeWidth="1.3"/>
      <text x="0" y="6.5" textAnchor="middle" fontFamily="serif" fontWeight="700" fontSize="17" fill="#fffef9">問</text></g>
      <circle cx="22" cy="60" r="2.2" fill="#1b1f2a"/><circle cx="30" cy="64" r="1.2" fill="#1b1f2a"/>
      </g>
    </svg>
  );
}
