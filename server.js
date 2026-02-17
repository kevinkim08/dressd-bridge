import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("DRESSD server running");
});

app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body;

  const token = process.env.REPLICATE_API_TOKEN;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt missing" });
  }

  try {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait"
      },
      body: JSON.stringify({
        model: "google/imagen-4",
        input: { prompt }
      })
    });

    const data = await response.json();

    const imageUrl = Array.isArray(data.output)
      ? data.output[0]
      : data.output;

    res.json({
      imageUrl
    });

  } catch (error) {
    res.status(500).json({ error: "Generation failed" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running");
});
