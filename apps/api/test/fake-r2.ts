// An in-memory R2 bucket with just what the photo routes use.

export function fakeR2() {
  const objects = new Map<string, { data: ArrayBuffer; contentType: string | undefined }>();
  const bucket = {
    async put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { data: value.slice(0), contentType: options?.httpMetadata?.contentType });
      return { key };
    },
    async get(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      return { arrayBuffer: async () => object.data.slice(0), body: new Blob([object.data]).stream() };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}
