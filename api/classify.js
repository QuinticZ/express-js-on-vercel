// api/classify.js

// --- Helpers ---------------------------------------------------------

/**
 * Normalize any "number-like" value into a real JS number or null.
 * Handles:
 *  - 3.2
 *  - "3.2"
 *  - "3,2"
 *  - "3.2 s"
 *  - "320 km/h"
 */
function normalizeNumber(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const cleaned = value
      .replace(",", ".") // european decimal → dot
      .replace(/[^0-9.\-]/g, ""); // strip units / junk

    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  return null;
}

function clamp01(n) {
  const v = normalizeNumber(n);
  if (v === null) return null;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// --- Main handler ----------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "Missing OPENAI_API_KEY environment variable",
      });
    }

    const { imageBase64, ping } = req.body || {};

    // Simple ping mode (used by Test API button)
    if (ping) {
      return res.status(200).json({
        success: true,
        message: "Minimal classify echo",
        method: req.method,
        body: req.body,
      });
    }

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: "No image provided (imageBase64 required)",
      });
    }

    // JSON SPEC INCLUDING ANTI-CHEAT + RARITY FIELDS
    const jsonSpec = {
      make: "string",
      model: "string",
      generation: "string|null",
      year_range: "string e.g. '1999-2002' or null",
      year_start: "number|null (4-digit year if known)",
      year_end: "number|null (4-digit year if known)",
      body_style: "string|null",
      engine: "string|null",
      horsepower: "number|null",
      torque_nm: "number|null",
      drivetrain: "string|null",
      country: "string|null",
      wiki_url: "string|null",
      confidence: "0..1 number",

      // rarity
      rarity_tier:
        "string one of 'Common','Uncommon','Rare','Epic','Legendary','Mythic'",
      rarity_score:
        "0..1 number where 0 is very common and 1 is extremely rare / almost unobtainable",
      rarity_reason:
        "short string explaining why this tier was chosen (production volume, age, special edition, homologation, etc.)",

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
      "Identify the car in this photo, detect cheating, and estimate rarity. " +
      "Rarity is about how often this exact car (make + model + generation/trim) appears in the real world, not in games. " +
      "Use tiers: Common, Uncommon, Rare, Epic, Legendary, Mythic. " +
      "Legendary/Mythic should be reserved for truly special cars: homologation specials, low-production exotics, " +
      "race-derived specials, iconic hypercars, one-offs, etc. " +
      "Return STRICT JSON ONLY with fields: " +
      JSON.stringify(jsonSpec);

    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an automotive visual recognition expert, rarity analyst, and anti-cheat system. " +
              "Be precise about make/model/generation. " +
              "For rarity_tier, think about production volume, year, special editions, homologation/race pedigree, " +
              "and how often this car would realistically be seen on roads or at events. " +
              "Do not call mass-produced normal cars 'Legendary' or 'Mythic'. " +
              "Only true exotics, icons, or extremely low-production cars should reach Legendary/Mythic. " +
              "If unsure, default toward more common tiers. " +
              "For anti-cheat, if you see monitor bezels, UI elements, pixels, moiré patterns, " +
              "reflections of a room on glass, or anything suggesting a TV/computer/phone, " +
              "set is_screen_photo = true and increase frame_suspicion. " +
              "Never add text outside the JSON.",
          },
          {
            role: "user",
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
      console.error("OpenAI upstream error:", openaiResp.status, errText);
      return res.status(502).json({
        success: false,
        error: "Upstream OpenAI error",
        status: openaiResp.status,
        detail: errText.slice(0, 500),
      });
    }

    const ai = await openaiResp.json();
    const raw = ai?.choices?.[0]?.message?.content || "{}";

    let car;
    try {
      car = JSON.parse(raw);
    } catch (parseErr) {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          car = JSON.parse(raw.slice(start, end + 1));
        } catch (innerErr) {
          console.error("Failed to salvage JSON:", innerErr, raw);
          return res.status(500).json({
            success: false,
            error: "Could not parse AI JSON after salvage",
            raw,
          });
        }
      } else {
        console.error("Raw content has no JSON object:", raw);
        return res.status(500).json({
          success: false,
          error: "Could not parse AI JSON",
          raw,
        });
      }
    }

    // ---------- NORMALIZE NUMERIC FIELDS ----------

    // Tech specs
    car.horsepower = normalizeNumber(car.horsepower);
    car.torque_nm = normalizeNumber(car.torque_nm);
    car.top_speed_kmh = normalizeNumber(car.top_speed_kmh);
    car.weight_kg = normalizeNumber(car.weight_kg);
    car.zero_to_hundred = normalizeNumber(car.zero_to_hundred);

    // Years
    car.year_start = normalizeNumber(car.year_start);
    car.year_end = normalizeNumber(car.year_end);

    if (!car.year_start || !car.year_end) {
      // Try to parse from year_range like "1999–2002"
      if (typeof car.year_range === "string") {
        const m = car.year_range.match(/(\d{4})\D+(\d{4})/);
        if (m) {
          const ys = parseInt(m[1], 10);
          const ye = parseInt(m[2], 10);
          if (Number.isFinite(ys)) car.year_start = ys;
          if (Number.isFinite(ye)) car.year_end = ye;
        }
      }
    }

    // Confidence + rarity score
    car.confidence = clamp01(car.confidence);
    car.rarity_score = clamp01(car.rarity_score);

    // ---------- DONE ----------

    return res.status(200).json({ success: true, car });
  } catch (error) {
    console.error("Handler crash:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      detail: String(error),
    });
  }
}
