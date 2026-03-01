import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

// ✅ CORS 확실히 열기 (Framer + Canvas + 로컬 허용)
const corsOptions = {
  origin: (origin, cb) => {
    // origin이 없을 때(서버-서버 호출/헬스체크)는 허용
    if (!origin) return cb(null, true)

    const ok =
      origin.includes("framer.app") ||
      origin.includes("framer.com") ||
      origin.includes("framercanvas.com") || // ✅ 이거 추가!!
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")

    if (ok) return cb(null, true)
    return cb(new Error("Not allowed by CORS: " + origin))
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}

app.use(cors(corsOptions))
// ✅ preflight(OPTIONS) 확실히 처리
app.options("*", cors(corsOptions))

app.use(express.json({ limit: "15mb" }))

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

// (기존 S1 endpoint 유지)
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

// ✅ /api/dress GET은 안내만
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

// ✅ /api/dress POST는 (너가 이미 붙인 try-on 로직이 있다면 여기 유지/추가하면 됨)
// 지금은 CORS 해결이 목적이라, 네 기존 /api/dress 구현이 이미 있으면 그대로 두고
// 위 CORS만 반영해도 됨.

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
app.post("/api/dress", async (req, res) => {
  try {
    const { view, model, garments } = req.body

    if (!model) {
      return res.status(400).json({
        ok: false,
        error: "model missing",
      })
    }

    // ✅ 테스트용: 모델 이미지를 그대로 반환
    return res.json({
      ok: true,
      imageDataUrl: model,
      debug: {
        view,
        garmentsCount: garments ? Object.keys(garments).length : 0,
      },
    })
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message ?? e),
    })
  }
})
