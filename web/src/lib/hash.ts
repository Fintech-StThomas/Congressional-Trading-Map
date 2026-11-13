// Small deterministic helpers shared by server and client.

/** FNV-1a 32-bit hash: stable across runs, used for print rotation and layout tie-breaks. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A tilt in degrees in [-max, max], fixed per id. */
export function tiltFor(id: string, max = 2.2): number {
  const u = fnv1a(id) / 0xffffffff;
  return Math.round((u * 2 - 1) * max * 10) / 10;
}

/** Org shard per the contract: first two hex characters of sha1(orgId). Browser only. */
export async function orgShard(orgId: string): Promise<string> {
  const bytes = new TextEncoder().encode(orgId);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  const first = new Uint8Array(digest)[0];
  return first.toString(16).padStart(2, "0");
}
