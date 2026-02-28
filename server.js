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

// ✅ 중요: S3는 dataUrl(base64)이 커서 기본 json 제한(100kb)으로는 터짐
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
  // ✅ 정책/안전: 성인 명시 + 나이 고정
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
 * S3 (Dress) - 1단계 ECHO 서버
 * =========================
 * Runner가 보내는 payload 예:
 * {
 *   view: "front"|"back",
 *   positive: "...",
 *   negative: "...",
 *   files: { model_single: "data:image/..", top_front:"...", ... },
 *   dressArrange: {...},
 *   dressArrangeForView: {...}
 * }
 *
 * ✅ 1단계 목표:
 * - 통신/연결 검증
 * - model_single 그대로 돌려주기
 * - arrange/keys 로그 확인
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

    // (선택) 디버그용: 들어온 키/arrange 확인
    const receivedKeys = Object.keys(files)
    const arrangeForView = body.dressArrangeForView || {}
    const arrangeKeys = Object.keys(arrangeForView)

    return res.json({
      dataUrl: model, // ✅ 지금은 합성/AI 없이 모델 그대로 반환 (연결 테스트)
      debug: {
        view,
        receivedKeysCount: receivedKeys.length,
        receivedKeys,
        arrangeKeysCount: arrangeKeys.length,
        arrangeKeys,
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
