// api/classify.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    // we accept image as a data URL:  data:image/jpeg;base64,AAAA...
    const { imageBase64 } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "No image provided (imageBase64 required)" });
    }

    // ask the model to return STRICT JSON describing the car
    const userText =
      "Identify the car in this photo. Return STRICT JSON ONLY with fields: " +
      JSON.stringify({
        make: "string",
        model: "string",
        generation: "string|null",
        year_range: "string e.g. '1999-2002' or null",
        body_style: "string|null",
        engine: "string|null",
        horsepower: "number|null",
        torque_nm: "number|null",
        drivetrain: "string|null",
        country: "string|null",
        wiki_url: "string|null",
        confidence: "0..1 number",
      });

    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        response_format: { type: "json_object" }, // force valid JSON
        messages: [
          {
            role: "system",
            content:
              "You are an automotive visual recognition expert. Be precise. If uncertain, set unknown fields to null and lower confidence.",
          },
          {
            role: "user",
            // multimodal: text + the image the app sent
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: imageBase64 } },
            ],
          },
        ],
      }),
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      return res.status(502).json({ error: "Upstream error", detail: errText });
    }

    const ai = await openaiResp.json();
    const raw = ai?.choices?.[0]?.message?.content || "{}";

    let car;
    try {
      car = JSON.parse(raw);
    } catch {
      // if the model slipped some text, try to salvage JSON with a basic fallback
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      car = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : null;
    }

    if (!car) {
      return res.status(500).json({ error: "Could not parse AI JSON", raw });
    }

    return res.status(200).json({ success: true, car });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
