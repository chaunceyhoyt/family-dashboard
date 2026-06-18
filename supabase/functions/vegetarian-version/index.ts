const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Attempt to salvage truncated JSON by closing open structures
function repairJson(raw: string): string {
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // Remove trailing comma before closing bracket/brace
  s = s.replace(/,\s*([\]\}])/g, '$1');
  // Count open braces/brackets and close them
  const stack: string[] = [];
  let inStr = false, escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inStr) { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  // Close any unterminated string
  if (inStr) s += '"';
  // Close open structures in reverse
  for (let i = stack.length - 1; i >= 0; i--) s += stack[i];
  return s;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { name, ingredients, steps } = await req.json();
    if (!name) return new Response(JSON.stringify({ error: 'name required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const prompt = `Convert this recipe to a pescatarian version using these rules:
- KEEP: fish (salmon, tuna, cod, tilapia, halibut, etc.), eggs, dairy, vegetables, grains, legumes, beans, tofu, nuts
- REMOVE: red meat (beef, pork, lamb), poultry (chicken, turkey, duck), shellfish (shrimp, crab, lobster, scallops, clams, mussels, oysters), lard, meat-based broths/stocks
- SUBSTITUTE removed items with fish, eggs, extra vegetables, beans, or legumes as appropriate. Use vegetable broth in place of meat broth.
- DO NOT use imitation or fake meat products (no plant-based ground beef, no mock chicken, no meat substitutes like Beyond Meat or Impossible). Use real whole foods instead.
- Keep the recipe as close to the original as possible — only change what needs to change

Recipe: ${name}

Ingredients:
${(ingredients || []).map((i: string) => `- ${i}`).join('\n')}

Steps:
${(steps || []).map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

Return ONLY a JSON object in this exact format (no markdown, no explanation):
{
  "ingredients": ["ingredient 1", "ingredient 2"],
  "steps": ["step 1", "step 2"],
  "note": "Brief one-sentence summary of substitutions made"
}

Keep the note very short (under 20 words). Be concise in steps.`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        }),
      }
    );

    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || 'Gemini error');

    const raw = d?.candidates?.[0]?.content?.parts
      ?.filter((p: { text?: string }) => p.text)
      ?.map((p: { text: string }) => p.text)
      ?.join('') || '{}';

    let result;
    try {
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      result = JSON.parse(clean);
    } catch {
      // Try to repair truncated JSON
      result = JSON.parse(repairJson(raw));
    }

    if (!result.ingredients || !Array.isArray(result.ingredients)) {
      throw new Error('Invalid response structure from AI');
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
