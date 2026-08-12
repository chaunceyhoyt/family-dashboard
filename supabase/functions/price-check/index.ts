const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bulk price check: POST { upcs: ["0001111086062", ...], locationId: "..." }
// Returns { results: { [upc]: { description, regular, promo, onSale } }, errors: [...] }
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { upcs, locationId } = await req.json();
    if (!Array.isArray(upcs) || !upcs.length) {
      return new Response(JSON.stringify({ error: 'upcs array required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const clientId = Deno.env.get('KROGER_CLIENT_ID');
    const clientSecret = Deno.env.get('KROGER_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Kroger credentials not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Client-credentials token (product.compact scope covers product lookups)
    const tokenRes = await fetch('https://api.kroger.com/v1/connect/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      },
      body: 'grant_type=client_credentials&scope=product.compact',
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData?.error_description || 'Kroger token error');
    const token = tokenData.access_token;

    const results: Record<string, unknown> = {};
    const errors: string[] = [];

    // Look up each UPC (productId is the 13-digit UPC), small concurrency to respect rate limits
    const queue = [...upcs.map(String)];
    const workers = Array.from({ length: 5 }, async () => {
      while (queue.length) {
        const upc = queue.shift();
        if (!upc) break;
        try {
          const url = `https://api.kroger.com/v1/products/${upc}${locationId ? `?filter.locationId=${locationId}` : ''}`;
          const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
          if (!r.ok) { errors.push(`${upc}: HTTP ${r.status}`); continue; }
          const d = await r.json();
          const item = d.data?.items?.[0];
          const price = item?.price;
          results[upc] = {
            description: d.data?.description || null,
            regular: price?.regular ?? null,
            promo: price?.promo && price.promo > 0 ? price.promo : null,
            onSale: !!(price?.promo && price.promo > 0 && price.promo < price.regular),
          };
        } catch (e) {
          errors.push(`${upc}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    });
    await Promise.all(workers);

    return new Response(JSON.stringify({ results, errors, checkedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
