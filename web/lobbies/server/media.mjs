// Media for the clans: images and short clips founders share. A file is accepted only if its bytes are one of a few
// image or video formats (read from the bytes, never from the name or the declared type: no SVG, no HTML), up to a
// size cap. It is stored under the hash of its bytes, belongs to the clan it was shared in, and is served only to
// that clan's members, with headers that stop a browser from reading it as anything else.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const MAX_BYTES = 8 * 1024 * 1024;

const startsWith = (b, bytes, at = 0) => bytes.every((x, i) => b[at + i] === x);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/** The media type of these bytes, or null if they are not an accepted format. */
export function sniff(b) {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, ascii("GIF87a")) || startsWith(b, ascii("GIF89a"))) return "image/gif";
  if (startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(b, ascii("ftyp"), 4)) {
    const brand = String.fromCharCode(...b.subarray(8, 12));
    if (["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(brand)) return "video/mp4";
    if (brand === "qt  ") return "video/quicktime";
  }
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  return null;
}

/** Media storage: in memory, or in `dir` (one file per hash, plus its metadata) so it survives restarts. */
export function createMedia({ dir = null, maxBytes = MAX_BYTES } = {}) {
  const meta = new Map(); // id -> { type, size, clan, by, at }
  const bytes = new Map(); // id -> Buffer, in memory mode
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const index = join(dir, "index.json");
    if (existsSync(index)) for (const [id, m] of Object.entries(JSON.parse(readFileSync(index, "utf8")))) meta.set(id, m);
  }
  const save = () => dir && writeFileSync(join(dir, "index.json"), JSON.stringify(Object.fromEntries(meta)));
  return {
    maxBytes,
    /** Stores a file shared in `clan` by `by`. Returns `{ id, type, size }` or throws with the reason. */
    put(buf, { clan, by, at = Date.now() }) {
      if (!buf.length) throw new Error("Empty file");
      if (buf.length > maxBytes) throw new Error("File too large");
      const type = sniff(buf);
      if (!type) throw new Error("Only PNG, JPEG, GIF, WebP, MP4, MOV and WebM files can be shared");
      const id = createHash("sha256").update(buf).update(clan).digest("hex");
      if (!meta.has(id)) {
        meta.set(id, { type, size: buf.length, clan, by, at });
        if (dir) writeFileSync(join(dir, id), buf); else bytes.set(id, buf);
        save();
      }
      return { id, type, size: buf.length };
    },
    info: (id) => meta.get(id) ?? null,
    get(id) {
      const m = /^[0-9a-f]{64}$/.test(id) ? meta.get(id) : null;
      if (!m) return null;
      return { ...m, bytes: dir ? readFileSync(join(dir, id)) : bytes.get(id) };
    },
  };
}
