// server.js
import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ✅ DEV에서는 전체 허용 (지금 단계에선 이게 맞음)
 * 운영 전환 시 아래 "ALLOWLIST 모드"로 바꾸면 됨.
 */
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
)
app.options("*", cors())

// ✅ dataUrl payload 크기 대비 (모델+의류 여러 장이면 커짐)
app.use(express.json({ limit: "80mb" }))

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

function isDataUrl(v) {
  return typeof v === "string" && v.startsWith("data:image/")
}

function normalizeModel(model) {
  if (typeof model === "string") return model
  if (model && typeof model === "object") {
    if (typeof model.dataUrl === "string") return model.dataUrl
    if (typeof model.url === "string") return model.url
  }
  return null
}

function pickFirstGarment(garmentsObj) {
  if (!garmentsObj || typeof garmentsObj !== "object") return null
  const keys = Object.keys(garmentsObj)
  if (!keys.length) return null
  // 현재는 1개만 먼저 붙여서 성공 루프를 만들자
  const k = keys[0]
  const v = garmentsObj[k]
  if (typeof v === "string") return { key: k, value: v }
  return null
}

/**
 * POST /api/dress
 * body:
 * {
 *   view: "front" | "back",
 *   model: "data:image/..."  // or {dataUrl}
 *   garments: { "top_front": "data:image/..." ... }
 *   clientTime, storeId
 * }
 */
app.post("/api/dress", async (req, res) => {
  try {
    const { view, model, garments, clientTime, storeId } = req.body || {}

    const v = view === "front" || view === "back" ? view : "front"
    const modelNorm = normalizeModel(model)

    if (!modelNorm) {
      return res.status(400).json({
        ok: false,
        error: "model missing",
        hint: "Expected body.model as dataUrl string OR {dataUrl} OR {url}",
        gotBodyKeys: Object.keys(req.body || {}),
        gotModelType: typeof model,
        gotGarmentsKeys:
          garments && typeof garments === "object" ? Object.keys(garments) : [],
      })
    }

    // ✅ garment 1개만 먼저 성공시키는 전략 (확장 쉬움)
    const firstGarment = pickFirstGarment(garments)

    // ✅ 아직 DRESS 모델을 안 붙였으면: 테스트 에코 (절대 안깨짐)
    const DRESS_MODEL = process.env.REPLICATE_DRESS_MODEL || ""
    if (!DRESS_MODEL || !process.env.REPLICATE_API_TOKEN) {
      return res.json({
        ok: true,
        mode: "echo",
        imageDataUrl: modelNorm,
        debug: {
          view: v,
          storeId: storeId || "no-store-id",
          clientTime: clientTime || null,
          modelIsDataUrl: isDataUrl(modelNorm),
          firstGarmentKey: firstGarment?.key || null,
          garmentsCount:
            garments && typeof garments === "object"
              ? Object.keys(garments).length
              : 0,
          note:
            "Set REPLICATE_API_TOKEN + REPLICATE_DRESS_MODEL to enable real try-on.",
        },
      })
    }

    // ✅ 여기부터 “진짜” try-on 호출
    // ⚠️ Replicate 모델마다 input 키가 다르다.
    // 그래서 일단 범용 구조로 만들고, 네가 정한 모델 스펙에 맞게 input만 맞추면 됨.
    const input = {
      // 흔한 패턴 예시 (모델에 맞게 교체)
      model_image: modelNorm,
      garment_image: firstGarment?.value || null,
      view: v,
    }

    const output = await replicate.run(DRESS_MODEL, { input })

    // output이 URL이거나 배열일 수 있어서 정규화
    let imageUrl = null
    if (Array.isArray(output)) imageUrl = output[0]
    else if (output?.url) imageUrl = output.url()
    else imageUrl = output

    if (!imageUrl) {
      return res.status(502).json({
        ok: false,
        error: "No imageUrl in output",
        output,
      })
    }

    return res.json({
      ok: true,
      mode: "replicate",
      imageUrl,
      debug: {
        view: v,
        storeId: storeId || "no-store-id",
        usedModel: DRESS_MODEL,
        usedGarmentKey: firstGarment?.key || null,
      },
    })
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Internal Server Error",
      detail: String(e?.message ?? e),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
