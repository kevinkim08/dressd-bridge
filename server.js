import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("DRESSD server running");
});

/**
 * ✅ 브라우저 테스트용 주소
 * 주소 뒤에 prompt 넣어서 테스트 가능
 * 예:
 * https://dressd-bridge.onrender.com/test?prompt=fashion%20model
 */
app.get("/test", async (req, res) => {
  const prompt = req.query.prompt || "fashion model studio photo";

  const token = process.env.REPLICATE_API_TOKEN;

  try {
    const response = await fetch(
  "https://api.replicate.com/v1/models/google/imagen-4/predictions",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait"
    },
    body: JSON.stringify({
      input: { prompt }
    })
  }
);


    const data = await response.json();

let imageUrl = null;

if (Array.isArray(data.output)) {
  imageUrl = data.output[0];
} else if (typeof data.output === "string") {
  imageUrl = data.output;
} else if (data.output?.url) {
  imageUrl = data.output.url;
}

console.log("Replicate output:", data);

    res.send(`
      <h2>✅ 이미지 생성 성공</h2>
      <p><b>Prompt:</b> ${prompt}</p>
      <img src="${imageUrl}" style="max-width:400px;border-radius:10px"/>
      <p>${imageUrl}</p>
    `);

  } catch (error) {
    res.status(500).send("❌ Generation failed");
  }
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

    res.json({ imageUrl });

  } catch (error) {
    res.status(500).json({ error: "Generation failed" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running");
});
