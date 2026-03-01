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
      origin.includes("framercanvas.com") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")

    if (ok) return cb(null, true)
    return cb(new Error("Not allowed by CORS: " + origin))
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}

app.use(cors(corsOptions))
app.options("*", cors(corsOptions))

app.use(express.json({ limit: "25mb" })) // dress dataUrl 고려해 좀 더 넉넉히

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

function isDataUrl(v) {
  return typeof v === "string" && v.startsWith("data:image/")
}

/**
 * ✅ dress payload에서 "현재 view"에 해당하는 garment를 하나 선택
 * - 지금은 가장 단순하게 top_front / top_back만 사용
 * - 추후 outer/bottom 등 확장 가능
 */
function pickGarment(view, garments) {
  const primary = view === "back" ? "top_back" : "top_front"
  const fallback = view === "back" ? "top_front" : "top_back"
  return garments?.[primary] || garments?.[fallback] || ""
}

/**
 * ----------------------------
 * ✅ (기존) S1 endpoint 유지
 * ----------------------------
 */
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
 * ----------------------------
 * ✅ (신규) S3 Dress endpoints
 * ----------------------------
 */

// 안내용
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress or GET /api/dress/:id" })
})

/**
 * ✅ 1) 합성 시작
 * POST /api/dress
 * - 네 Runner payload 그대로 받음: { view, model, garments, ... }
 * - 응답: { predictionId, status }
 */
app.post("/api/dress", async (req, res) => {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: "REPLICATE_API_TOKEN missing on server" })
    }

    const VERSION_ID = process.env.REPLICATE_DRESS_VERSION_ID
    if (!VERSION_ID) {
      return res.status(500).json({ error: "REPLICATE_DRESS_VERSION_ID missing on server" })
    }

    const { view = "front", model, garments = {} } = req.body || {}

    if (!isDataUrl(model)) {
      return res.status(400).json({ error: "model must be a dataUrl (data:image/...)" })
    }

    const garment = pickGarment(view, garments)
    if (!isDataUrl(garment)) {
      return res.status(400).json({
        error: "garment missing. Need top_front/top_back (dataUrl)",
      })
    }

    /**
     * ⚠️ 중요:
     * 아래 input 키(model_image, garment_image)는 "네가 선택한 Replicate 모델" 스키마에 맞춰야 함.
     * 오늘은 일단 OOTDiffusion류처럼 model_image/garment_image로 가정.
     * 만약 네 모델이 다른 키를 쓰면, 여기 키 2개만 바꾸면 끝.
     */
    const prediction = await replicate.predictions.create({
      version: VERSION_ID,
      input: {
        model_image: model,
        garment_image: garment,
        steps: 20,
        guidance_scale: 2,
        seed: 0,
      },
    })

    return res.status(202).json({
      predictionId: prediction.id,
      status: prediction.status,
    })
  } catch (e) {
    return res.status(500).json({
      error: String(e?.message ?? e),
    })
  }
})

/**
 * ✅ 2) 결과 확인 (폴링)
 * GET /api/dress/:id
 * - 응답:
 *   processing이면 202
 *   succeeded면 imageUrl 반환
 */
app.get("/api/dress/:id", async (req, res) => {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: "REPLICATE_API_TOKEN missing on server" })
    }

    const pred = await replicate.predictions.get(req.params.id)

    if (pred.status === "succeeded") {
      const output = pred.output
      const imageUrl = Array.isArray(output) ? output[0] : output

      return res.json({
        predictionId: pred.id,
        status: pred.status,
        imageUrl,
      })
    }

    if (pred.status === "failed" || pred.status === "canceled") {
      return res.status(500).json({
        predictionId: pred.id,
        status: pred.status,
        error: pred.error || "prediction failed",
      })
    }

    // starting / processing
    return res.status(202).json({
      predictionId: pred.id,
      status: pred.status,
    })
  } catch (e) {
    return res.status(500).json({
      error: String(e?.message ?? e),
    })
  }
})

// ✅ 마지막에 listen
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
