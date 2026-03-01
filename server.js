import express from "express"
import cors from "cors"

const app = express()

/**
 * ✅ CORS (테스트 모드: 전체 허용)
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
 * ✅ dataUrl은 커질 수 있어서 넉넉히
 */
app.use(express.json({ limit: "50mb" }))

app.get("/", (req, res) => {
  res.send("DRESSD bridge running")
})

app.get("/health", (req, res) => {
  res.json({ ok: true })
})

app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

/**
 * ✅ POST /api/dress
 * - 프론트가 기대하는 키: imageDataUrl OR imageUrl
 * - 지금은 테스트용으로 model dataUrl을 그대로 반환
 */
app.post("/api/dress", async (req, res) => {
  try {
    const { view, model, garments, storeId, clientTime } = req.body

    console.log("POST /api/dress", {
      view,
      modelType: typeof model,
      garmentCount: garments ? Object.keys(garments).length : 0,
      storeId,
      clientTime,
    })

    // ✅ model 필수 (dataUrl string)
    if (!model || typeof model !== "string") {
      return res.status(400).json({
        ok: false,
        error: "model missing",
        hint: "Expected body.model as dataUrl string",
        gotBodyKeys: Object.keys(req.body || {}),
        gotModelType: typeof model,
      })
    }

    // ✅ garments optional
    const garmentKeys = garments ? Object.keys(garments) : []

    // ✅ 프론트가 읽을 수 있게 표준 키로 반환
    // - 지금은 테스트 단계니까 model을 그대로 결과로 내려줌
    return res.json({
      ok: true,
      imageDataUrl: model, // ✅ 핵심! Viewer가 이 키를 찾음
      view: view || "front",
      debug: {
        garmentCount: garmentKeys.length,
      },
    })
  } catch (err) {
    console.error("SERVER ERROR:", err)
    return res.status(500).json({
      ok: false,
      error: "server error",
      detail: String(err?.message || err),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("DRESSD bridge running on port", PORT))
