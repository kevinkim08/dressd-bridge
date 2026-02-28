import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ✅ CORS (Framer + Local)
 * - OPTIONS 프리플라이트도 자동 처리되게 함
 */
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
app.use(express.json({ limit: "25mb" })) // ✅ dataUrl이 커질 수 있어서 넉넉히

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

/**
 * ✅ (중요) 브라우저에서 /api/dress 눌렀을 때 "Cannot GET"이 보기 싫으면
 * GET도 하나 만들어두면 확인이 편해짐
 */
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

/**
 * ✅ Replicate (지금은 아직 S3 합성 모델을 안붙였으니 '연결 테스트'만)
 * - 나중에 여기서 실제 try-on 모델로 교체하면 됨
 */
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

/**
 * ✅ POST /api/dress
 * - 지금 단계 목표: 프론트가 서버를 잘 때리고, 응답을 받아서 Viewer에 표시되는지 확인
 *
 * 기대 입력(프론트에서):
 * {
 *   view: "front" | "back",
 *   files: { "model_single": "data:image/..", "top_front": "...", ... },
 *   meta?: { ... }
 * }
 */
app.post("/api/dress", async (req, res) => {
  try {
    const { view, files } = req.body || {}

    if (!files || typeof files !== "object") {
      return res.status(400).json({ error: "files missing" })
    }

    const model = files["model_single"]
    if (!model) {
      return res.status(400).json({ error: "model_single missing" })
    }

    // ✅ 1단계: 합성 없이 "연결 테스트"로 모델 이미지를 그대로 반환
    // - 프론트가 이 값을 받아서 Viewer에 띄우면 파이프가 살아있는 거
    // - 나중에 여기서 실제 try-on 결과 imageUrl/dataUrl로 교체하면 됨
    return res.json({
      ok: true,
      view: view || "front",
      output: model, // dataUrl 그대로 돌려줌
      debug: {
        hasModel: true,
        keys: Object.keys(files),
      },
    })
  } catch (e) {
    return res.status(500).json({
      error: "dress api failed",
      detail: String(e?.message ?? e),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
