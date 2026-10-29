const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { items } = await req.json();
    if (!items || !Array.isArray(items)) {
      return new Response(JSON.stringify({ error: 'items array required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prompt = `You are a grocery list consolidator. Combine duplicate or similar items by summing quantities where possible.
- If you're confident (e.g. "2 cups flour" + "1 cup flour" → "3 cups flour"), just merge them and set uncertain: false.
- If you're unsure whether items should be merged (e.g. different varieties), set uncertain: true so the user can confirm.
- Items with no duplicates pass through unchanged with uncertain: false.

Grocery list:
${items.map((item: string, i: number) => `${i + 1}. ${item}`).join('\n')}

Return ONLY a JSON array:
[{"text": "consolidated item text", "uncertain": false}]`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' },
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

    let consolidated: unknown[];
    try { consolidated = JSON.parse(json); if (!Array.isArray(consolidated)) consolidated = []; }
    catch { consolidated = []; }

    return new Response(JSON.stringify({ consolidated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
