const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { query, location, radius, category } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: 'query required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const loc = location || 'Chesapeake VA 23322';
    const miles = radius || '100';
    const itemCategory = category ? category.toLowerCase().trim() : 'general';

    // ── Platform & attribute routing ──────────────────────────────────────────
    let sources = 'Facebook Marketplace, Craigslist, OfferUp';
    let specificAttributes = 'condition, brand, key specifications, original price (if known)';
    let localizationNote = '';

    const locLower = loc.toLowerCase();
    if (locLower.includes('canada')) {
      localizationNote = 'For Canada, prioritize Kijiji, Facebook Marketplace, and AutoTrader.ca.';
    } else if (locLower.includes('uk') || locLower.includes('united kingdom') || locLower.includes('london')) {
      localizationNote = 'For the UK, prioritize Gumtree, Facebook Marketplace, and eBay UK.';
    } else if (locLower.includes('australia')) {
      localizationNote = 'For Australia, prioritize Gumtree, Facebook Marketplace, and Carsales.';
    }

    switch (itemCategory) {
      case 'car':
      case 'vehicle':
      case 'motorcycle':
      case 'rv':
        sources = 'CarGurus, AutoTrader, Cars.com, Bring a Trailer, eBay Motors, Facebook Marketplace, Craigslist';
        specificAttributes = 'mileage, year, make, model, trim, engine/motor, transmission (automatic/manual), title status (clean/salvage), drivetrain (AWD/FWD/RWD)';
        break;

      case 'furniture':
      case 'decor':
      case 'home':
        sources = 'Facebook Marketplace, OfferUp, Craigslist, AptDeco, Kaiyo, Nextdoor, Chairish';
        specificAttributes = 'exact dimensions (width x depth x height), material (e.g., solid oak, leather), brand/designer, condition (e.g., minor scratches, like new), pet-free/smoke-free home status';
        break;

      case 'electronics':
      case 'phone':
      case 'computer':
      case 'camera':
        sources = 'eBay, Swappa, BackMarket, Mercari, Facebook Marketplace, OfferUp, Craigslist';
        specificAttributes = 'model year, storage capacity (GB/TB), carrier status (unlocked/carrier-locked), cosmetic condition, battery health percentage, included accessories (chargers, cases)';
        break;

      case 'appliance':
      case 'appliances':
        sources = 'Facebook Marketplace, Craigslist, OfferUp, Lowes Outlet, Best Buy Outlet, Sears Outlet';
        specificAttributes = 'dimensions, fuel/power type (gas, electric, 110V/220V), brand, age/model number, color/finish (e.g., stainless steel, matte black)';
        break;

      case 'tools':
      case 'hardware':
      case 'garden':
        sources = 'Facebook Marketplace, Craigslist, OfferUp, eBay, Pawn America';
        specificAttributes = 'power source (cordless/corded/gas), battery/charger inclusion, voltage (e.g., 18V, 20V Max), brand, working condition';
        break;

      case 'fashion':
      case 'clothing':
      case 'shoes':
      case 'accessories':
        sources = 'Poshmark, Depop, Mercari, Grailed, eBay, Facebook Marketplace';
        specificAttributes = 'size, brand/designer, material, authenticity status, condition (e.g., New With Tags [NWT], gently used)';
        break;

      case 'collectibles':
      case 'toys':
      case 'hobbies':
      case 'art':
        sources = 'eBay, Mercari, Etsy (vintage), TCGplayer (for cards), Facebook Marketplace, Craigslist';
        specificAttributes = 'authenticity/grading status (e.g., PSA grade, certificate of authenticity), year produced, rarity/edition, condition details, original packaging status';
        break;

      case 'sports':
      case 'outdoors':
      case 'bikes':
        sources = 'SidelineSwap (sports gear), Pinkbike (bikes), Pro\'s Closet, Facebook Marketplace, Craigslist, OfferUp';
        specificAttributes = 'frame size (for bikes), wheel size, sports-specific specs (e.g., flex for hockey sticks, loft for golf clubs), brand, model year';
        break;

      default:
        sources = 'Facebook Marketplace, Craigslist, OfferUp, eBay, Nextdoor';
        specificAttributes = 'brand, model, condition, key specifications, retail price if available';
    }

    // ── Build prompt ──────────────────────────────────────────────────────────
    const prompt = `Search for individual real active listings for: "${query}" near ${loc} within a ${miles} mile radius.

Target the following platforms primarily: ${sources}. Find at least 5 real specific listings.${localizationNote ? ` LOCALIZATION RULE: ${localizationNote}` : ''}

CRITICAL: The "url" field must be the direct, deep-link URL to that exact individual listing — not a homepage, category page, or general search results page. Look closely at your search results and extract the exact listing link.

Focus on extracting these category-specific attributes for the specs object: ${specificAttributes}.

Return a JSON array following this exact schema:
[{ "title": "Listing Title", "price": "$X,XXX or $XX", "location": "City, ST", "source": "Site Name", "url": "https://exact-url-to-this-listing", "category": "${itemCategory}", "specs": { "attribute_name": "attribute_value" }, "summary": "2-3 sentences about this item", "pros": ["...", "..."], "cons": ["...", "..."] }]`;

    // ── Call Gemini ───────────────────────────────────────────────────────────
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            // responseMimeType removed: incompatible with google_search tool
          },
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

    let listings: unknown[];
    try {
      listings = JSON.parse(json);
      if (!Array.isArray(listings)) listings = [];
    } catch {
      listings = [];
    }

    return new Response(JSON.stringify({ listings }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
