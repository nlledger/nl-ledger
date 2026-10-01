// One security baseline for static assets and Worker-rendered HTML.
// No script/style restrictions: the inline theme setup, charts and Turnstile remain usable.
export const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "interest-cohort=()",
  "Strict-Transport-Security": "max-age=15552000",
  "Content-Security-Policy":
    "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
});

// Hashed asset paths run through the entry guard so only misses get no-store.
export const STATIC_HEADERS = `/*
${Object.entries(SECURITY_HEADERS)
  .map(([name, value]) => `  ${name}: ${value}`)
  .join("\n")}
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
/share/static/*
  Cache-Control: public, max-age=31536000, immutable
/fonts/archivo-roman.woff2
  Cache-Control: public, max-age=31536000, immutable
/fonts/archivo-italic.woff2
  Cache-Control: public, max-age=31536000, immutable
/fonts/archivo-card.ttf
  Cache-Control: public, max-age=31536000, immutable
/site.css
  Cache-Control: public, max-age=31536000, immutable
/app.js
  Cache-Control: public, max-age=31536000, immutable
/data/*
  Cache-Control: public, max-age=3600
  Access-Control-Allow-Origin: *
/server.json
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600
/llms.txt
  Content-Type: text/plain; charset=utf-8
  Access-Control-Allow-Origin: *
`;
