// server.js
import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ✅ CORS: 테스트 단계 전체 허용
 */
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
)
app.options("*", cors())

/**
 * ✅ dataUrl 큼 → limit 늘림
 */
app.use(express.json({ limit: "25mb" }))

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

/**
 * =========================================================
 * ✅ Replicate (S1)
 * =========================================================
 */
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

function withAdultGuard(prompt) {
  return `adult, age 25, ${prompt}`
}

app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body

  if (!process.env.REPLICATE_API_TOKEN) {
    return res
      .status(500)
      .json({ error: "REPLICATE_API_TOKEN missing on server" })
  }
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

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
 * ✅ S3 Dress endpoint (연결/디버그: model echo)
 * - Runner가 보내는 형태:
 *   { view, model, garments, clientTime, storeId }
 * =========================================================
 */
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

function pickDataUrl(x) {
  if (!x) return ""
  if (typeof x === "string") return x
  if (typeof x === "object") {
    // 흔한 형태들 대응
    if (typeof x.dataUrl === "string") return x.dataUrl
    if (typeof x.url === "string") return x.url
    if (typeof x.image === "string") return x.image
  }
  return ""
}

app.post("/api/dress", async (req, res) => {
  try {
    const body = req.body || {}

    const view = body.view || "front"
    const storeId = body.storeId || "no-storeId"

    // ✅ Runner가 보내는 방식 우선 수용
    const modelDataUrl = pickDataUrl(body.model)

    // ✅ garments는 객체일 확률이 큼 (slotKey -> dataUrl)
    const garments = body.garments && typeof body.garments === "object"
      ? body.garments
      : {}

    console.log("[/api/dress] storeId:", storeId, "view:", view)
    console.log("[/api/dress] body keys:", Object.keys(body))
    console.log(
      "[/api/dress] garments keys:",
      Object.keys(garments).slice(0, 80)
    )
    console.log("[/api/dress] model type:", typeof body.model)
    console.log("[/api/dress] modelDataUrl length:", modelDataUrl?.length || 0)

    if (!modelDataUrl) {
      return res.status(400).json({
        ok: false,
        error: "model missing",
        hint: "Expected body.model as dataUrl string OR {dataUrl}.",
        gotBodyKeys: Object.keys(body),
        gotModelType: typeof body.model,
        gotGarmentsKeys: Object.keys(garments || {}),
      })
    }

    // ✅ 1차 목표: 서버-프론트 연결 확인용으로 model을 그대로 반환
    return res.json({
      ok: true,
      mode: "TEST_ECHO_MODEL",
      view,
      storeId,
      gotBodyKeys: Object.keys(body),
      gotGarmentsKeys: Object.keys(garments || {}),
      imageDataUrl: modelDataUrl,
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

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
