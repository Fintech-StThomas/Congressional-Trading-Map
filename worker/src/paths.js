// Path and id validation for the release Worker: a port of validate_path / validate_release_id in
// pipeline/release_manifest.py. worker/test/path-cases.json is shared with a Python test that checks both agree.

export const RESERVED_ROOT_FILES = new Set(["release.json", "_manifest.json"]);

/** A 64-character lowercase hexadecimal string (release ids and blob hashes). */
export function isHex64(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * True for a safe relative POSIX path: no empty, "." or ".." segment, no backslash, colon or control character
 * (code units below 32, and 127), and not a reserved root file. `allowReserved` is for the legacy data/ tree, where
 * `_manifest.json` is an ordinary public object.
 */
export function isSafePath(value, { allowReserved = false } = {}) {
  if (typeof value !== "string" || value === "" || value.includes("\\") || value.includes(":")) return false;
  if (value.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return allowReserved || !RESERVED_ROOT_FILES.has(value);
}

/** Percent-decode a URL path remainder; null when the encoding is malformed. */
export function decodePath(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
