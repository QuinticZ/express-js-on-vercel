export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Accept either { imageBase64: "data:image/jpeg;base64,..." } or { image: "..." }
    const { imageBase64, image } = req.body || {};
    const payload = imageBase64 || image;

    if (!payload) {
      return res.status(400).json({ error: "No image provided" });
    }

    // TODO: Here you will send `payload` to your AI model.
    // For now we just confirm we received bytes.
    const sizeKb = Math.round(payload.length / 1024);

    const mockCarData = {
      name: "Pagani Zonda C12 S",
      manufacturer: "Pagani Automobili",
      year: 2002,
      type: "Coupe",
      horsepower: 555,
      engine: "7.3L V12",
      country: "Italy",
      confidence: 0.98,
      receivedKB: sizeKb,
    };

    return res.status(200).json({ success: true, car: mockCarData });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
