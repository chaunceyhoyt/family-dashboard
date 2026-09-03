const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Best-effort cross-store price comparison via Gemini + Google Search.
// POST { items: [{ name, upc, krogerPrice }], location? }
// Returns { results: [{ name, walmart, target, harristeeter, notes }], checkedAt }
// Prices are search-derived estimates, not live store data.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { items, location } = await req.json();
    if (!Array.isArray(items) || !items.length) {
      return new Response(JSON.stringify({ error: 'items array required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (items.length > 12) {
      return new Response(JSON.stringify({ error: 'max 12 items per call' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const loc = location || 'Chesapeake VA 23322';
    const list = items.map((it: { name: string; upc?: string; krogerPrice?: number }, i: number) =>
      `${i + 1}. ${it.name}${it.upc ? ` — UPC/barcode: ${it.upc}` : ''}${it.krogerPrice ? ` (Kroger price: $${it.krogerPrice})` : ''}`).join('\n');

    const prompt = `Find current prices for these grocery products at Walmart, Target, and Harris Teeter near ${loc}.

Products:
${list}

Product names can differ slightly between retailers (different wording, capitalization, or listing title) even for the exact same item, so DO NOT rely on the name text matching exactly. For each product that has a UPC/barcode listed, treat that UPC as the authoritative identifier:
- Prefer searching each store's site directly by the UPC/barcode number (e.g. "site:walmart.com <UPC>", "site:target.com <UPC>", "site:harristeeter.com <UPC>", or a general web search for the UPC) — this returns the exact matching product regardless of title wording.
- Only fall back to searching by product name/description if the UPC search returns nothing.
- If a UPC-based result and a name-based result disagree, trust the UPC match.

Rules:
- Report the price for the SAME product and size where possible; if only a comparable size is found, note it.
- If a store doesn't carry the item or no confident match is found, use null rather than guessing.
- Prices should be current regular or sale prices from your search results.

Return ONLY a JSON array (no markdown), one object per product in the same order:
[{ "name": "product name", "walmart": 3.99, "target": null, "harristeeter": 4.29, "notes": "brief note only if size differs, price is a sale, or match was by UPC not name" }]`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        }),
      }
    );

    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || 'Gemini error');

    const raw = d?.candidates?.[0]?.content?.parts
      ?.filter((p: { text?: string }) => p.text)
      ?.map((p: { text: string }) => p.text)
      ?.join('') || '[]';

    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let results: unknown[];
    try {
      results = JSON.parse(json);
      if (!Array.isArray(results)) results = [];
    } catch {
      results = [];
    }

    return new Response(JSON.stringify({ results, checkedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
