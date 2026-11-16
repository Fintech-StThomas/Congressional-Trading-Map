// Test doubles for the Worker: an in-memory R2 bucket binding (get/head with body, size, httpMetadata, httpEtag) that
// counts reads, and a fake Cache API. Not a test file.

export function fakeBucket(objects = {}) {
  const store = new Map(Object.entries(objects));
  const calls = [];
  const describe = (key) => {
    const entry = store.get(key);
    const data = typeof entry === "string" ? { body: entry } : entry;
    const bytes = new TextEncoder().encode(data.body);
    return { key, size: data.size ?? bytes.length, httpEtag: `"etag-${key}"`, httpMetadata: data.type ? { contentType: data.type } : {}, text: data.body };
  };
  return {
    calls,
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    async head(key) {
      calls.push(["head", key]);
      if (!store.has(key)) return null;
      const { text, ...meta } = describe(key);
      return meta;
    },
    async get(key) {
      calls.push(["get", key]);
      if (!store.has(key)) return null;
      const { text, ...meta } = describe(key);
      return { ...meta, body: new Blob([text]).stream() };
    },
    async list() {
      throw new Error("the Worker must never list the bucket");
    },
  };
}

export function fakeCaches() {
  const entries = new Map();
  const log = [];
  return {
    log,
    default: {
      async match(request) {
        log.push(["match", request.url]);
        const hit = entries.get(request.url);
        return hit ? hit.clone() : undefined;
      },
      async put(request, response) {
        log.push(["put", request.url]);
        entries.set(request.url, response.clone());
      },
    },
  };
}
