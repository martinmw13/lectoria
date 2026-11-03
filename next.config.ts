import type { NextConfig } from 'next';

const scriptSrc = [
  "'self'",
  // Needed for the Next inline bootstrap without nonces; shortcut: upgrade to nonces later.
  "'unsafe-inline'",
  'https://challenges.cloudflare.com',
  ...(process.env.NODE_ENV === 'development' ? ["'unsafe-eval'"] : []),
].join(' ');

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  'frame-src https://challenges.cloudflare.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Older browsers ignore CSP frame-ancestors; same rule, legacy header.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // Track files never change in place (a new encode gets a new
        // version folder), so repeat visits skip the download entirely.
        source: '/music/v1/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // Content-hash keys (narration/v2/<voice>/<hash>); any edit
        // gives a new key, and puts forbid overwrite.
        source: '/narration/v2/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // Committed v1 loops with no in-place writer; a re-encode
        // gets a new version folder, same as music.
        source: '/ambience/v1/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // Placeholder art replaced at the same paths (see SOURCES.md),
        // so no immutable: a short cache with background refresh.
        source: '/art/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' },
        ],
      },
      {
        // Shelf covers can be repainted at the same paths by
        // pregen:covers, so the same short cache as /art.
        source: '/covers/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' },
        ],
      },
    ];
  },
};

export default nextConfig;
