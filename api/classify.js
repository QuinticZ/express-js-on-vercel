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

    // NEW JSON SPEC WITH ANTI-CHEAT FIELDS
    const jsonSpec = {
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

      // anti-cheat
      is_screen_photo:
        "boolean (true if this looks like a photo of a screen, TV, monitor, laptop, phone, or printed photo)",
      real_world_confidence:
        "0..1 number (your confidence that this is a real physical car in the environment, not a screen/screenshot)",
      frame_suspicion:
        "0..1 number (your suspicion that the user is trying to cheat by photographing a screen or non-real car)",
      environment:
        "short string|null (e.g. 'outdoor street at night', 'indoor parking garage', 'computer screen on desk')",
      notes:
        "short string explaining why you decided on screen or real car; mention clues like bezels, UI, reflections, moiré, etc.",
    };

    const userText =
      "Identify the car in this photo AND detect cheating. " +
      "Return STRICT JSON ONLY with fields: " +
      JSON.stringify(jsonSpec);

    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini", // your existing model
        response_format: { type: "json_object" }, // force valid JSON
        messages: [
          {
            role: "system",
            content:
              "You are an automotive visual recognition expert AND anti-cheat system. " +
              "Be precise about make/model, but ALSO determine if this is a real physical car or an image on a screen. " +
              "If you see monitor bezels, UI elements, pixels, moiré patterns, reflections of a room on glass, or anything
