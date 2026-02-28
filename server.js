import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

// ✅ CORS 확실히 열기 (Framer + 로컬 허용)
const corsOptions = {
  origin: (origin, cb) => {
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
app.options("*", cors(corsOptions)) // ✅ 프리플라이트 강제 허용
app.use(express.json({ limit: "80mb" }))

// ✅ dataUrl(base64) 크니까 limit 올려둠
app.use(express.json({ limit: "80mb" }))

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
  return `adult, age 25, ${prompt}`
}

/**
 * =========================
 * S1 (Imagen)
 * =========================
 */
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

/**
 * =========================
 * S3 (Dress) - ECHO (연결 테스트용)
 * =========================
 * - 지금은 합성 없이 "model_single"을 그대로 반환
 * - Runner 연결/플로우 먼저 완성시키는 용도
 */
app.post("/api/dress", async (req, res) => {
  try {
    const body = req.body || {}
    const view = body.view || "front"
    const files = body.files || {}
    const model = files.model_single

    if (!model) {
      return res.status(400).json({ error: "model_single missing" })
    }

    return res.json({
      dataUrl: model,
      debug: {
        view,
        receivedKeys: Object.keys(files),
        hasArrangeForView: !!body.dressArrangeForView,
        hasArrange: !!body.dressArrange,
      },
    })
  } catch (e) {
    return res.status(500).json({
      error: "Dress endpoint failed",
      detail: String(e?.message ?? e),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
