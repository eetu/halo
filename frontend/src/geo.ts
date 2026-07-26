const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

export type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  };
};

const headers = {
  Accept: "application/json",
};

export async function searchLocation(query: string): Promise<NominatimResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "5",
    addressdetails: "1",
  });
  const res = await fetch(`${NOMINATIM_BASE}/search?${params}`, { headers });
  return res.json();
}

export async function reverseGeocode(lat: number, lon: number): Promise<NominatimResult> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: "json",
    zoom: "10",
  });
  const res = await fetch(`${NOMINATIM_BASE}/reverse?${params}`, { headers });
  return res.json();
}

export function getCityName(result: NominatimResult): string {
  const addr = result.address;
  if (addr) {
    return (
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      result.name ||
      result.display_name
    );
  }
  return result.name || result.display_name;
}
