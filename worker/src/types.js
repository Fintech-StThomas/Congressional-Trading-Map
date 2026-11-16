// Content types by file extension, matching pipeline/publish_r2.py content_type for the files the archive holds.

const TYPES = {
  json: "application/json",
  geojson: "application/geo+json",
  csv: "text/csv",
  txt: "text/plain",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

export function contentTypeFor(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return TYPES[ext] || "application/octet-stream";
}
