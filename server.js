import express from "express"
import cors from "cors"

const app = express()

/**
 * ✅ CORS (테스트 모드: 전체 허용)
 * Failed to fetch 90% 원인 제거
 */
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
)

app.options("*", cors())

app.use(express.json({ limit: "10mb" }))

/**
 * health check
 */
app.get("/", (req, res) => {
  res.send("DRESSD bridge running")
})

app.get("/health", (req, res) => {
  res.json({ ok: true })
})

/**
 * GET 테스트
 */
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

/**
 * POST /api/dress
 */
app.post("/api/dress", async (req, res) => {
  try {
    const { view, model, garments } = req.body

    // 🔍 요청 확인 로그 (Render Logs에서 확인 가능)
    console.log("REQUEST VIEW:", view)
    console.log("MODEL TYPE:", typeof model)
    console.log("GARMENTS:", garments ? Object.keys(garments) : [])

    // 모델 필수
    if (!model || typeof model !== "string") {
      return res.status(400).json({
        ok: false,
        error: "model missing",
        hint: "model must be dataUrl string",
      })
    }

    // garments는 optional
    const garmentKeys = garments ? Object.keys(garments) : []

    /**
     * 🔥 현재는 테스트용:
     * 실제 AI 대신 모델 이미지를 그대로 반환
     * → Runner & Viewer 정상 동작 검증 목적
     */
    return res.json({
      ok: true,
      outputFront: view === "front" ? model : undefined,
      outputBack: view === "back" ? model : undefined,
      debug: {
        garmentCount: garmentKeys.length,
      },
    })
  } catch (err) {
    console.error(err)

    return res.status(500).json({
      ok: false,
      error: "server error",
      detail: String(err.message || err),
    })
  }
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log("DRESSD bridge running on port", PORT)
})
