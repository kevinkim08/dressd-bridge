import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

// ✅ CORS (Framer + 로컬)
// 커스텀 도메인/preview 도메인일 수도 있어서 "framer"만 포함해도 통과시키게 완화
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)

    const ok =
      origin.includes("framer.app") ||
      origin.includes("framer.com") ||
      origin.includes("framer") || // ✅ 프리뷰/커스텀 케이스 완화
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")

    if (ok) return cb(null, true)
    return cb(new Error("Not allowed by CORS: " + origin))
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}

app.use(cors(corsOptions))
app.use(express.json({ limit: "25mb" })) // ✅ base64 이미지 받으니까 넉넉히

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

function withAdultGuard(prompt) {
  return `adult, age 25, ${prompt}`
}

// --------------------
// ✅ Step1 (이미 쓰고 있는 것)
// --------------------
app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body

  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({ error: "REPLICATE_API_TOKEN missing on server" })
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
      ? output[0]?.url ? output[0].url() : output[0]
      : output?.url ? output.url() : output

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

// --------------------
// ✅ Step3 Dress (지금은 “연결 확인용 더미”)
// --------------------
// 프론트가 보내는 payload:
// { view, model:{mime,b64}, garments:[{key,mime,b64}...], storeId, clientTime }
app.post("/api/dress", async (req, res) => {
  try {
    const { view, model, garments, storeId } = req.body ?? {}

    // ✅ 최소 검증
    if (!view) return res.status(400).json({ error: "view missing" })
    if (!model?.b64) return res.status(400).json({ error: "model.b64 missing" })

    // ✅ 지금은 AI 합성 전이라, “모델 이미지를 그대로 반환”해서
    // 프론트 Viewer가 뜨는지부터 확인한다.
    // (이 단계 통과되면 다음에 진짜 dressing 모델 붙이면 됨)
    const mime = model?.mime || "image/png"
    const dataUrl = `data:${mime};base64,${model.b64}`

    console.log("[/api/dress] ok", {
      view,
      storeId,
      garmentsCount: Array.isArray(garments) ? garments.length : 0,
    })

    return res.json({
      ok: true,
      view,
      dataUrl,
      note: "DUMMY: returning model image as output. Next step: replace with real dressing.",
    })
  } catch (e) {
    return res.status(500).json({
      error: "Dress failed",
      detail: String(e?.message ?? e),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
