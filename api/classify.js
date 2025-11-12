export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No image provided" });
    }

    const mockCarData = {
      name: "Pagani Zonda C12 S",
      manufacturer: "Pagani Automobili",
      year: 2002,
      type: "Coupe",
      horsepower: 555,
      engine: "7.3L V12",
      country: "Italy",
      confidence: 0.98,
    };

    return res.status(200).json({
      success: true,
      car: mockCarData,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
