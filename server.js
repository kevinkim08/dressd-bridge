// server.js
import express from "express"
import cors from "cors"

const app = express()

// ✅ CORS (Framer + local)
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
app.options("*", cors(corsOptions))

// ✅ dataUrl JSON 크기 대응 (중요)
app.use(express.json({ limit: "50mb" }))

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

// ✅ 확인용: GET으로 치면 힌트 반환
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

function isDataUrl(v) {
  return typeof v === "string" && v.startsWith("data:image/")
}

// model이 string(dataUrl) 또는 {dataUrl,url} 형태 모두 허용
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
    const garmentKeys = garments && typeof garments === "object" ? Object.keys(garments) : []

    // ✅ model 필수
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

    // ✅ view 체크
    const v = view === "front" || view === "back" ? view : "front"

    // ✅ garments는 옵션 (없어도 됨). 대신 디버그로 보여줌.
    const debug = {
      view: v,
      storeId: storeId || "no-store-id",
      clientTime: clientTime || null,
      gotModelType: typeof modelNorm,
      modelIsDataUrl: isDataUrl(modelNorm),
      garmentsCount: garmentKeys.length,
      garmentKeys,
    }

    // ✅ 지금은 “파이프라인 확인” 단계:
    // - output은 model을 그대로 돌려준다 (Runner/Viewer 작동 확인용)
    return res.json({
      ok: true,
      imageDataUrl: modelNorm,
      debug,
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
