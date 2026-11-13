// ID generation that works outside secure contexts.
//
// crypto.randomUUID() only exists in a secure context (HTTPS or localhost).
// Over plain HTTP on a LAN — how this app is normally opened on a phone
// (http://<host>:8085) — `crypto.randomUUID` is undefined, so calling it
// throws "crypto.randomUUID is not a function" and item setup dies.
// Fall back to crypto.getRandomValues when available, then Math.random.
// Output is still RFC 4122 v4 shaped in all three paths.
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
