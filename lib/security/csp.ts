/**
 * Content-Security-Policy for every HTML page (operator console, login and
 * heir portal). Scripts need the per-request nonce ('strict-dynamic' lets
 * Next.js's own nonced scripts load their chunks); nothing may load from
 * another origin, be framed by another site, or post a form elsewhere.
 *
 * Styles allow 'unsafe-inline': React renders style attributes and the letter
 * preview (a sandboxed srcdoc iframe, which inherits this policy) has an inline
 * <style>. With img/font/connect limited to 'self', injected CSS can't send
 * data anywhere.
 */
export function buildCsp(nonce: string, opts: { dev: boolean; https: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${opts.dev ? " ws: wss:" : ""}`,
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

/** 128 random bits, base64. Web Crypto, so it also works where Node's crypto module isn't loaded. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Pages anyone may open without an operator session (each has its own checks). */
export function isPublicPage(pathname: string): boolean {
  return /^\/(login|portal)(\/|$)/.test(pathname) || /^\/(p|u)\/[^/]+\/?$/.test(pathname);
}
