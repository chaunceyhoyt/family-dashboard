import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Credentials come from Supabase secrets (Edge Functions → Secrets), never source code
const CLIENT_ID = Deno.env.get('KROGER_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('KROGER_CLIENT_SECRET') ?? '';
const BASE = 'https://api.kroger.com/v1';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function getAppToken(): Promise<string> {
  const creds = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const r = await fetch(`${BASE}/connect/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'product.compact' }),
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('App token failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function kSearch(appToken: string, term: string, locationId?: string) {
  const params: Record<string, string> = { 'filter.term': term, 'filter.limit': '5' };
  if (locationId) params['filter.locationId'] = locationId;
  const r = await fetch(`${BASE}/products?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${appToken}`, Accept: 'application/json' },
  });
  const data = await r.json();
  if (!r.ok) return null;
  return (data.data && data.data.length > 0) ? data.data : null;
}

async function cartAdd(token: string, upc: string, quantity: number, modality: string) {
  const payload = JSON.stringify({ items: [{ upc, quantity, modality }] });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let r = await fetch(`${BASE}/cart/add`, { method: 'PUT', headers, body: payload });
  if (r.status === 405) r = await fetch(`${BASE}/cart/add`, { method: 'POST', headers, body: payload });
  const text = await r.text();
  return { status: r.status, ok: r.ok || r.status === 204, body: text.slice(0, 500) };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'Kroger credentials not configured' }, 500);
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'token') {
      const { code, redirect_uri } = await req.json();
      const creds = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
      const r = await fetch(`${BASE}/connect/oauth2/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri }),
      });
      return json(await r.json(), r.status);
    }

    if (action === 'refresh') {
      const { refresh_token } = await req.json();
      const creds = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
      const r = await fetch(`${BASE}/connect/oauth2/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token }),
      });
      return json(await r.json(), r.status);
    }

    if (action === 'location') {
      const { lat, lon } = await req.json();
      const appToken = await getAppToken();
      const params = new URLSearchParams({
        'filter.latLong.near': `${lat},${lon}`,
        'filter.limit': '5',
        'filter.radiusInMiles': '25',
      });
      const r = await fetch(`${BASE}/locations?${params}`, {
        headers: { Authorization: `Bearer ${appToken}`, Accept: 'application/json' },
      });
      return json(await r.json(), r.status);
    }

    if (action === 'search') {
      const { term, locationId, history } = await req.json();
      const appToken = await getAppToken();
      if (history?.length) {
        const match = history.find((h: { term: string }) => h.term.toLowerCase() === term.toLowerCase());
        if (match) {
          const r = await fetch(
            `${BASE}/products/${match.upc}` + (locationId ? `?filter.locationId=${locationId}` : ''),
            { headers: { Authorization: `Bearer ${appToken}`, Accept: 'application/json' } }
          );
          if (r.ok) { const data = await r.json(); if (data.data) return json({ data: [data.data], source: 'history' }); }
        }
      }
      const organicResults = await kSearch(appToken, `organic ${term}`, locationId);
      if (organicResults) return json({ data: organicResults, source: 'organic' });
      const plainResults = await kSearch(appToken, term, locationId);
      return json({ data: plainResults || [], source: 'plain' });
    }

    if (action === 'cart') {
      const { token, upc, quantity, modality } = await req.json();
      const result = await cartAdd(token, upc, quantity ?? 1, modality ?? 'PICKUP');
      return json({ kroger_status: result.status, kroger_ok: result.ok, kroger_body: result.body, upc_sent: upc }, result.ok ? 200 : result.status);
    }

    if (action === 'cart-view') {
      const { token } = await req.json();
      const r = await fetch(`${BASE}/cart`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const text = await r.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
      return json({ status: r.status, data }, r.ok ? 200 : r.status);
    }

    if (action === 'whoami') {
      const { token } = await req.json();
      let jwtClaims = null;
      try {
        const parts = token.split('.');
        if (parts.length === 3) jwtClaims = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
      } catch { jwtClaims = null; }
      const profileRes = await fetch(`${BASE}/identity/profile`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      const profile = await profileRes.json().catch(() => null);
      const creds = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
      const introRes = await fetch(`${BASE}/connect/oauth2/introspect`, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
      const introspect = await introRes.json().catch(() => null);
      return json({ jwt_claims: jwtClaims, profile_status: profileRes.status, profile, introspect_status: introRes.status, introspect });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
