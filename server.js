// server.js
import express from "express"
import cors from "cors"

const app = express()

// ✅ TEST MODE: allow all origins (잠깐만 이렇게 해서 CORS 원인 확정)
app.use(
  cors({
    origin: true, // 요청 들어온 Origin을 그대로 허용
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
)
app.options("*", cors())

// ✅ dataUrl payload 크기 대응
app.use(express.json({ limit: "50mb" }))

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
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

app.post("/api/dress", async (req, res) => {
  try {
    const { view, model, garments, clientTime, storeId } = req.body || {}

    const modelNorm = normalizeModel(model)
    const garmentKeys =
      garments && typeof garments === "object" ? Object.keys(garments) : []

    if (!modelNorm) {
      return res.status(400).json({
        ok: false,
        error: "model missing",
        hint: "Expected body.model as dataUrl string OR {dataUrl} OR {url}",
        gotBodyKeys: Object.keys(req.body || {}),
        gotModelType: typeof model,
        gotGarmentsKeys: garmentKeys,
      })
    }

    const v = view === "front" || view === "back" ? view : "front"

    return res.json({
      ok: true,
      // ✅ 지금은 파이프라인 확인용: model 그대로 리턴
      imageDataUrl: modelNorm,
      debug: {
        view: v,
        storeId: storeId || "no-store-id",
        clientTime: clientTime || null,
        modelIsDataUrl: isDataUrl(modelNorm),
        garmentsCount: garmentKeys.length,
        garmentKeys,
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
