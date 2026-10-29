const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Drafts a maintenance schedule for a household asset.
// POST { name, category, model?, year?, mileage?, notes?, existing?: string[] }
// Returns { tasks: [{ title, desc, recurEvery, recurUnit, dueNow }] }
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const { name, category, model, year, mileage, notes, existing } = await req.json();
    if (!name) return json({ error: 'name required' }, 400);
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 500);

    const age = year ? `${new Date().getFullYear() - parseInt(year)} years old (from ${year})` : 'unknown age';
    const prompt = `You are a home and vehicle maintenance expert. Draft a practical recurring maintenance schedule for this family asset.

Asset: ${name}
Category: ${category || 'other'}
Make/model: ${model || 'unknown'}
Age: ${age}
${mileage ? `Mileage/hours: ${mileage}\n` : ''}${notes ? `Owner notes: ${notes}\n` : ''}${Array.isArray(existing) && existing.length ? `Already scheduled (do not repeat): ${existing.join('; ')}\n` : ''}
Rules:
- 5 to 12 tasks a homeowner would actually do or book, specific to this make/model and its age where it matters (e.g. older items need inspections; cars by typical mileage converted to time for average driving of ~12k miles/year).
- Each task recurs on a fixed interval: recurUnit is one of "day", "week", "month", "year" and recurEvery is a whole number.
- desc is one short sentence: what to do or what to look for, including part sizes/specs when known for this model.
- dueNow is true only if, given the age, the task is likely overdue or worth doing right away.

Return ONLY a JSON array:
[{ "title": "Replace air filter", "desc": "...", "recurEvery": 3, "recurUnit": "month", "dueNow": false }]`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || 'Gemini error');
    const raw = d?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '[]';
    let list: unknown;
    try { list = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()); } catch { list = []; }
    // The model sometimes wraps the array, e.g. { "tasks": [...] }
    if (list && !Array.isArray(list) && typeof list === 'object') {
      list = Object.values(list as Record<string, unknown>).find(v => Array.isArray(v)) || [];
    }
    const units = new Set(['day', 'week', 'month', 'year']);
    const tasks = (Array.isArray(list) ? list : [])
      .filter((t: any) => t && t.title && units.has(t.recurUnit) && Number(t.recurEvery) >= 1)
      .map((t: any) => ({ title: String(t.title), desc: String(t.desc || ''), recurEvery: Math.round(Number(t.recurEvery)), recurUnit: t.recurUnit, dueNow: !!t.dueNow }));
    if (!tasks.length) return json({ tasks, error: 'Could not read the suggestions', raw: raw.slice(0, 300) });
    return json({ tasks });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
