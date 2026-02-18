import express from "express";
import cors from "cors";
import Replicate from "replicate";

const app = express();

/**
 * ✅ CORS "확실히" 열기
 * - Framer(프론트) → Render(서버) 호출에서 "Failed to fetch" 방지
 * - 가장 확실한 방식은 origin:"*" (전체 허용)
 *   (나중에 보안 강화할 땐 특정 도메인만 허용하면 됨)
 */
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // ✅ preflight 대응(중요)

app.use(express.json());

app.get("/", (req, res) => {
  res.send("DRESSD server running");
});

// ✅ health check용
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

function withAdultGuard(prompt) {
  // 사람/얼굴 모델에서 "아동" 오탐 방지용 안전장치
  return `adult, age 25, ${prompt}`;
}

// ✅ STEP1 API
app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body;

  if (!process.env.REPLICATE_API_TOKEN) {
    return res
      .status(500)
      .json({ error: "REPLICATE_API_TOKEN missing on server" });
  }
  if (!prompt) {
    return res.status(400).json({ error: "Prompt missing" });
  }

  try {
    const finalPrompt = withAdultGuard(prompt);

    // ✅ 핵심: 공식 run 방식
    const output = await replicate.run("google/imagen-4", {
      input: { prompt: finalPrompt },
    });

    // output이 1장일 때도/배열일 때도 있어서 안전 처리
    const imageUrl = Array.isArray(output)
      ? output[0]?.url
        ? output[0].url()
        : output[0]
      : output?.url
      ? output.url()
      : output;

    if (!imageUrl) {
      return res.status(502).json({
        error: "No imageUrl in output (possibly blocked/failed).",
        output,
      });
    }

    return res.json({ imageUrl, usedPrompt: finalPrompt });
  } catch (e) {
    // 429 같은 것도 여기로 들어올 수 있음
    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));
