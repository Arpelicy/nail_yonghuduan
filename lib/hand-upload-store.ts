// Module-level singleton — survives Next.js client-side navigation within the same tab.
let _rawUrl: string | null = null;
let _natural = { w: 1, h: 1 };

export const handUploadStore = {
  set(url: string, natural: { w: number; h: number }) {
    _rawUrl = url;
    _natural = { ...natural };
  },
  get() {
    return { rawUrl: _rawUrl, natural: _natural };
  },
  clear() {
    if (_rawUrl) URL.revokeObjectURL(_rawUrl);
    _rawUrl = null;
    _natural = { w: 1, h: 1 };
  },
};
