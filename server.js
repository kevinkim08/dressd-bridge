import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

// ✅ CORS 확실히 열기 (Framer + 로컬 허용)
const corsOptions = {
  origin: (origin, cb) => {
    // origin이 없을 때(서버-서버 호출/헬스체크)는 허용
    if (!origin) return cb(null, true)

    const ok =
      origin.includes("framer.app") ||
      origin.includes("framer.com") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")

    if (ok) return cb(null, true)
    return cb(new Error("Not allowed by CORS: " + origin))
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}

app.use(cors(corsOptions))
app.use(express.json())

app.get("/", (req, res) => {
  res.send("DRESSD server running")
})

app.get("/health", (req, res) => {
  res.json({ ok: true })
})

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

function withAdultGuard(prompt) {
  // ✅ 정책/안전: 성인 명시 + 나이 고정
  return `adult, age 25, ${prompt}`
}

app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body

  if (!process.env.REPLICATE_API_TOKEN) {
    return res
      .status(500)
      .json({ error: "REPLICATE_API_TOKEN missing on server" })
  }
  if (!prompt) {
    return res.status(400).json({ error: "Prompt missing" })
  }

  try {
    const finalPrompt = withAdultGuard(prompt)

    // ✅ 품질 개선 핵심:
    // - image_size: "2K" (2048) → 확대해도 덜 흐림
    // - aspect_ratio: "9:16" → 전신/모바일 최적
    // - output_format: "png" → JPEG 압축 노이즈 줄임
    const output = await replicate.run("google/imagen-4", {
      input: {
        prompt: finalPrompt,
        image_size: "2K",
        aspect_ratio: "9:16",
        output_format: "png",
      },
    })

    const imageUrl = Array.isArray(output)
      ? output[0]?.url
        ? output[0].url()
        : output[0]
      : output?.url
        ? output.url()
        : output

    if (!imageUrl) {
      return res.status(502).json({
        error: "No imageUrl in output (possibly blocked/failed).",
        output,
      })
    }

    return res.json({ imageUrl, usedPrompt: finalPrompt })
  } catch (e) {
    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running"))
