// api/classify.js

// --- helpers ----------------------------------------------------

/**
 * Parse a value into a number if possible:
 * - accepts numbers
 * - accepts strings like "3.2", "3,2", "3.2 s", "320 km/h"
 * - otherwise returns null
 */
function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").replace(/[^0-9.\-]/g, "");
    if (!normalized) return null;
    const num = parseFloat(normalized);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function normalizeDrivetrain(dt) {
  if (!dt || typeof dt !== "string") return null;
  const s = dt.toUpperCase();

  if (s.includes("AWD") || s.includes("4MATIC") || s.includes("QUATTRO")) {
    return "AWD";
  }
  if (s.includes("4WD")) return "4WD";
  if (s.includes("RWD") || s.includes("REAR")) return "RWD";
  if (s.includes("FWD") || s.includes("FRONT")) return "FWD";

  return null;
}

function normalizeCategory(cat) {
  if (!cat || typeof cat !== "string") return null;
  const s = cat.toLowerCase();

  if (s.includes("hyper")) return "hypercar";
  if (s.includes("super")) return "supercar";
  if (s.includes("track")) return "track-only";
  if (s.includes("muscle")) return "muscle car";
  if (s.includes("hatch")) return "hatchback";
  if (s.includes("suv")) return "suv";
  if (s.includes("wagon")) return "wagon";
  if (s.includes("coupe")) return "coupe";
  if (s.includes("sedan") || s.includes("saloon")) return "sedan";

  return "other";
}

function normalizePrestige(make, prestigeHint) {
  const hint = (prestigeHint || "").toLowerCase();
  const m = (make || "").toLowerCase();

  if (hint === "ultra" || hint === "high") {
    return hint;
  }

  if (["pagani", "bugatti", "koenigsegg", "rimac"].includes(m)) return "ultra";
  if (["ferrari", "lamborghini", "porsche", "aston martin", "mclaren"].includes(m)) {
    return "high";
  }
  if (["bmw", "mercedes-benz", "mercedes", "audi", "lexus", "dodge", "chevrolet"].includes(m)) {
    return "medium";
  }
  return "low";
}

function normalizeRegion(country, regionHint) {
  const hint = (regionHint || "").toLowerCase();
  const c = (country || "").toLowerCase();

  if (["europe", "eu"].includes(hint)) return "Europe";
  if (["japan", "asia"].includes(hint)) return "Japan";
  if (["usa", "united states", "america"].includes(hint)) return "USA";
  if (hint) return "Other";

  if (["italy", "germany", "france", "uk", "united kingdom", "sweden", "spain"].includes(c)) {
    return "Europe";
  }
  if (["japan"].includes(c)) return "Japan";
  if (["usa", "united states", "america"].includes(c)) return "USA";

  return "Other";
}

function normalizeAspiration(engine, hint) {
  const h = (hint || "").toLowerCase();
  const e = (engine || "").toLowerCase();

  const src = h || e;

  if (!src) return null;
  if (src.includes("electric")) return "electric";
  if (src.includes("hybrid")) return "hybrid";
  if (src.includes("twin-turbo") || src.includes("bi-turbo")) return "twin-turbo";
  if (src.includes("turbo")) return "turbo";
  if (src.includes("supercharg")) return "supercharged";
  if (src.includes("na") || src.includes("naturally aspirated")) return "na";

  return null;
}

function computeRarityScore(car) {
  let score = 0;

  // Production volume (biggest factor)
  const pn = toNumber(car.production_numbers);
  if (pn != null) {
    if (pn < 10) score += 10;
    else if (pn < 30) score += 8;
    else if (pn < 100) score += 6;
    else if (pn < 1000) score += 4;
    else if (pn < 5000) score += 3;
    else if (pn < 20000) score += 2;
    else if (pn < 100000) score += 1;
  }

  // Performance: 0–100 km/h
  const zero100 = toNumber(car.zero_to_hundred);
  if (zero100 != null) {
    if (zero100 < 3.5) score += 3;
    else if (zero100 < 5.0) score += 2;
    else if (zero100 < 7.0) score += 1;
  }

  // Output power
  const hp = toNumber(car.horsepower);
  if (hp != null) {
    score += Math.min(hp / 200, 3); // cap bonus at ~600 hp
  }

  // Prestige by make
  const make = (car.make || "").toLowerCase();
  if (["pagani", "bugatti", "koenigsegg", "rimac"].includes(make)) score += 3;
  else if (["ferrari", "lamborghini", "porsche", "aston martin", "mclaren"].includes(make)) {
    score += 2;
  } else if (["bmw", "mercedes-benz", "mercedes", "audi", "lexus", "dodge", "chevrolet"].includes(make)) {
    score += 1;
  }

  // Category
  const cat = normalizeCategory(car.vehicle_category);
  if (cat === "hypercar") score += 4;
  else if (cat === "supercar") score += 2;
  else if (cat === "track-only") score += 5;

  return Math.round(score);
}

function getRarityTier(score) {
  if (score >= 18) return "Mythic";
  if (score >= 12) return "Legendary";
  if (score >= 8) return "Epic";
  if (score >= 5) return "Rare";
  if (score >= 3) return "Uncommon";
  return "Common";
}

function slugify(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildCarSlug(car) {
  const parts = [];
  if (car.make) parts.push(car.make);
  if (car.model) parts.push(car.model);
  if (car.generation) parts.push(car.generation);
  const base = slugify(parts.join(" "));
  if (car.year_start && Number.isFinite(car.year_start)) {
    return `${base}_${car.year_start}`;
  }
  return base || null;
}

/**
 * Normalize all fields coming from the model:
 * - coerce numeric fields to numbers
 * - normalize categorical fields
 * - derive year_range if missing
 * - compute rarity_score, rarity_tier, car_slug
 */
function normalizeCarObject(rawCar) {
  const car = { ...rawCar };

  // Numbers
  car.horsepower = toNumber(car.horsepower);
  car.torque_nm = toNumber(car.torque_nm);
  car.weight_kg = toNumber(car.weight_kg);
  car.zero_to_hundred = toNumber(car.zero_to_hundred);
  car.top_speed_kmh = toNumber(car.top_speed_kmh);
  car.production_numbers = toNumber(car.production_numbers);

  // Years
  car.year_start = toNumber(car.year_start);
  car.year_end = toNumber(car.year_end);

  if (!car.year_range && (car.year_start || car.year_end)) {
    const ys = car.year_start || null;
    const ye = car.year_end || null;
    if (ys && ye && ys !== ye) {
      car.year_range = `${ys}-${ye}`;
    } else if (ys) {
      car.year_range = `${ys}`;
    } else if (ye) {
      car.year_range = `${ye}`;
    }
  }

  // Categorical
  car.drivetrain = normalizeDrivetrain(car.drivetrain);
  car.vehicle_category = normalizeCategory(car.vehicle_category);
  car.prestige_class = normalizePrestige(car.make, car.prestige_class);
  car.region = normalizeRegion(car.country, car.region);
  car.engine_aspiration = normalizeAspiration(car.engine, car.engine_aspiration);

  // Confidence / anti-cheat
  car.confidence = toNumber(car.confidence);
  car.real_world_confidence = toNumber(car.real_world_confidence);
  car.frame_suspicion = toNumber(car.frame_suspicion);

  // Rarity
  const rarityScore = computeRarityScore(car);
  car.rarity_score = rarityScore;
  car.rarity_tier = getRarityTier(rarityScore);

  // Slug
  car.car_slug = buildCarSlug(car);

  return car;
}

// --- handler ----------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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

    // Simple ping for Test API button (no OpenAI call)
    if (ping === true) {
      return res.status(200).json({
        success: true,
        message: "Ping OK",
      });
    }

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: "No image provided (imageBase64 required)",
      });
    }

    // JSON SPEC INCLUDING ANTI-CHEAT + RARITY INPUT FIELDS
    const jsonSpec = {
      make: "string",
      model: "string",
      generation: "string|null",
      year_start: "number|null (start production year YYYY, numeric only)",
      year_end: "number|null (end production year YYYY, numeric only)",
      year_range: "string|null e.g. '1999-2002' or single year '2004'",

      body_style: "string|null",
      engine: "string|null (e.g. '3.9L twin-turbo V8')",
      horsepower: "number|null (hp, numeric only, no units)",
      torque_nm: "number|null (Nm, numeric only, no units)",
      drivetrain: "string|null (one of 'FWD','RWD','AWD','4WD' or similar)",

      weight_kg: "number|null (kg, numeric only, no units)",
      zero_to_hundred:
        "number|null (0–100 km/h time in seconds, numeric only, use dot decimal separator, e.g. 3.2)",
      top_speed_kmh:
        "number|null (top speed in km/h, numeric only, no units)",
      production_numbers:
        "number|null (estimated total units produced, numeric only, no units)",

      country: "string|null (country of origin, e.g. 'Italy')",
      region: "string|null (one of 'Europe','Japan','USA','Other') if you know it",
      wiki_url: "string|null (Wikipedia or authoritative reference URL if known)",

      vehicle_category:
        "string|null (e.g. 'hypercar','supercar','sports car','sedan','hatchback','SUV','truck','wagon','muscle car','track-only')",
      prestige_class:
        "string|null (one of 'low','medium','high','ultra' based on brand and exclusivity)",
      engine_aspiration:
        "string|null (one of 'NA','turbo','twin-turbo','supercharged','hybrid','electric')",

      confidence: "number 0..1 (overall confidence of make/model identification)",

      // anti-cheat
      is_screen_photo:
        "boolean (true if this looks like a photo of a screen, TV, monitor, laptop, phone, or printed photo)",
      real_world_confidence:
        "number 0..1 (confidence that this is a real physical car in the environment, not a screen/screenshot)",
      frame_suspicion:
        "number 0..1 (suspicion that the user is trying to cheat by photographing a screen, printed photo, or non-real car)",
      environment:
        "string|null (e.g. 'outdoor street at night','indoor parking garage','computer screen on desk')",
      notes:
        "short string explaining your decisions about real vs screen and any uncertainty; mention clues like bezels, UI, pixels, moiré, reflections, etc.",
    };

    const userText =
      "Identify the car in this photo, estimate its production context, and detect cheating. " +
      "Return STRICT JSON ONLY with fields: " +
      JSON.stringify(jsonSpec) +
      ". " +
      "For all numeric fields, return bare numbers ONLY (no units, no labels), using '.' as decimal separator where needed.";

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
              "You are an automotive visual recognition expert, production historian, and anti-cheat system. " +
              "Be precise about make/model/generation and reasonably accurate about production years and production numbers. " +
              "NEVER invent completely random models; if uncertain, lower confidence and leave unknown fields as null. " +
              "For ALL numeric fields, return bare numbers ONLY (no units, no text), using '.' as decimal separator. " +
              "Also determine if the image is a real car or a photo of a screen / printed media. " +
              "Never add any text outside the JSON object.",
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

    let rawCar;
    try {
      rawCar = JSON.parse(raw);
    } catch (parseErr) {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          rawCar = JSON.parse(raw.slice(start, end + 1));
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

    const car = normalizeCarObject(rawCar);

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
