// api/classify.js
export default async function handler(req, res) {
  try {
    // Just echo back what we got, to prove the function runs
    return res.status(200).json({
      success: true,
      message: "Minimal classify echo",
      method: req.method,
      body: req.body || null,
    });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({
      success: false,
      error: "Handler crashed",
      detail: String(err),
    });
  }
}
