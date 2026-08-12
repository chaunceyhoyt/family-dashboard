const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bulk price check.
//  POST { upcs: [...], locationId }  → returns results (app merges + saves)
//  POST { cron: true, locationId? } → loads price_watch from DB, checks all
//    items, merges results + lowest-price history, saves back. Used by pg_cron.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const cronMode = !!body.cron;
    let upcs: string[] = body.upcs || [];
    let locationId: string | undefined = body.locationId;
    let watch: Record<string, unknown> | null = null;

    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = (path: string, init?: RequestInit) =>
      fetch(`${supaUrl}/rest/v1/${path}`, {
        ...init,
        headers: {
          'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json', ...(init?.headers || {}),
        },
      });

    if (cronMode) {
      const r = await db(`family_data?key=eq.price_watch&select=value`);
      const rows = await r.json();
      watch = rows?.[0]?.value || null;
      if (!watch || !Array.isArray(watch.items) || !watch.items.length) {
        return new Response(JSON.stringify({ error: 'no price_watch items' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      upcs = (watch.items as { upc: string }[]).map(i => i.upc);
      locationId = locationId || (watch.locationId as string | undefined);
    }

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
    const checkedAt = new Date().toISOString();

    if (cronMode && watch) {
      // Merge into stored price_watch and save
      const w = watch as { results?: Record<string, unknown>; lowest?: Record<string, number>; lastCheck?: string };
      w.results = w.results || {};
      w.lowest = w.lowest || {};
      for (const [upc, res] of Object.entries(results)) {
        const r = res as { regular: number | null; promo: number | null; onSale: boolean };
        w.results[upc] = { ...r, checkedAt };
        const effective = r.onSale ? r.promo : r.regular;
        if (effective != null && (w.lowest[upc] == null || effective < w.lowest[upc])) w.lowest[upc] = effective;
      }
      w.lastCheck = checkedAt;
      await db(`family_data?key=eq.price_watch`, {
        method: 'PATCH',
        body: JSON.stringify({ value: watch, updated_at: checkedAt }),
      });
    }

    return new Response(JSON.stringify({ results, errors, checkedAt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
