const API_BASE = import.meta.env.VITE_API_URL ?? "";

export const api = (path: string) => `${API_BASE}${path}`;

// `no-store` on every API read: none of these responses carry a validator, and
// iOS Safari heuristically caches an unlabelled GET — an installed PWA then
// keeps serving last night's payload out of its own disk cache no matter how
// often SWR revalidates. The backend sends `Cache-Control: no-store` too; this
// is the same belt-and-braces as `useDeployReload`.
export const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((res) => res.json());

export class HttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export const jsonFetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
};
