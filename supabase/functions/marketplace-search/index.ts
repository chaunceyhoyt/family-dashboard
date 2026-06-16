import Anthropic from "npm:@anthropic-ai/sdk@0.27.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, location, radius } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = new Anthropic();

    const prompt = `You are a helpful assistant that simulates marketplace listing search results for demonstration purposes.

Generate 6-10 realistic fake marketplace listings for someone searching for "${query}" near ${location || "Chesapeake, VA"} within ${radius || 50} miles.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "listings": [
    {
      "title": "item title",
      "price": "$XX",
      "location": "City, ST",
      "distance": "X miles away",
      "description": "brief description of the item",
      "url": "https://www.facebook.com/marketplace",
      "source": "Facebook Marketplace",
      "postedAgo": "X hours ago",
      "emoji": "relevant emoji"
    }
  ]
}

Make the listings realistic with varied prices, conditions, and distances. Include relevant details like year, make/model for vehicles, size/condition for items.`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "";

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse listings from response");
    }

    const data = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("marketplace-search error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
