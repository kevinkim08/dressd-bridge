// server.js
import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ✅ CORS (Framer + 로컬 허용)
 */
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

/**
 * ✅ JSON 바디 사이즈 크게 (이미지 dataUrl이 커서 기본값이면 터질 수 있음)
 */
app.use(express.json({ limit: "25mb" }))

app.get("/", (req, res) => {
  res.send("DRESSD server running")
})

app.get("/health", (req, res) => {
  res.json({ ok: true })
})

/**
 * =========================================================
 * ✅ Replicate (S1 전용)
 * =========================================================
 */
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
 * =========================================================
 * ✅ S3 Dress endpoint (디버그/연결 확인용)
 *
 * - GET: 힌트만 반환
 * - POST: 들어온 payload에서 model을 "관대하게" 찾고
 *         우선 model dataUrl을 그대로 돌려줌 (echo)
 *
 * 목적:
 * - Runner가 실제로 어떤 구조로 body를 보내는지 확인
 * - files 키가 무엇인지 / model 키가 무엇인지 확인
 * - 네트워크 / CORS / JSON limit 문제 분리
 * =========================================================
 */
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

app.post("/api/dress", async (req, res) => {
  try {
    const body = req.body || {}
    const view = body.view || "front"
    const storeId = body.storeId || "no-storeId"

    // ✅ 여러 가능성에서 files 후보를 다 모음
    const files =
      body.files ||
      body.dressFiles ||
      body.payload?.files ||
      body.payload?.dressFiles ||
      {}

    console.log("[/api/dress] storeId:", storeId, "view:", view)
    console.log("[/api/dress] body keys:", Object.keys(body))
    console.log(
      "[/api/dress] files keys:",
      Object.keys(files || {}).slice(0, 80)
    )

    // ✅ model 후보 키들도 여러개로 탐색
    const model =
      files["model_single"] ||
      files["model"] ||
      files["model_front"] ||
      files["MODEL"] ||
      body.model_single ||
      body.model ||
      body.payload?.model_single ||
      body.payload?.model

    if (!model || typeof model !== "string") {
      return res.status(400).json({
        ok: false,
        error: "model missing",
        hint: "Expected model_single in files (or compatible key).",
        gotBodyKeys: Object.keys(body),
        gotFilesKeys: Object.keys(files || {}),
      })
    }

    // ✅ 1단계: 일단 모델을 그대로 echo해서
    // 프론트에서 output이 보이면 "연결 + 렌더링"이 확정됨
    return res.json({
      ok: true,
      mode: "TEST_ECHO_MODEL",
      view,
      storeId,
      gotBodyKeys: Object.keys(body),
      gotFilesKeys: Object.keys(files || {}),
      imageDataUrl: model,
    })
  } catch (e) {
    console.error("[/api/dress] error:", e)
    return res.status(500).json({
      ok: false,
      error: "Internal error in /api/dress",
      detail: String(e?.message ?? e),
    })
  }
})

/**
 * ✅ 에러 핸들러 (CORS 등)
 */
app.use((err, req, res, next) => {
  if (err) {
    console.error("[server error]", err)
    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
    })
  }
  next()
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
