/**
 * JSON replies are handed to Next uncompressed on purpose.
 *
 * Next compresses route handler responses at egress (`next start`, 16.4.6+) and
 * strips any `Content-Encoding` a handler sets, because it cannot tell a body it
 * decompressed itself from one the handler compressed (GHSA-pc58-hwjq-p385).
 * Compressing here therefore ships gzip bytes labelled as plain JSON, and the
 * client fails to parse them.
 */
export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(data), { ...init, headers });
}
