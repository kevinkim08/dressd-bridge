import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

// ✅ body가 dataUrl이면 커서 터질 수 있음
app.use(express.json({ limit: "25mb" }))

/**
 * ✅ CORS: 프레이머 미리보기/배포 도메인이 여러개라 넓게 허용
 * - 나중에 안정화되면 좁혀도 됨
 */
const corsOptions = {
  origin: (origin, cb) => {
    // 서버-서버/헬스체크(Origin 없음) 허용
    if (!origin) return cb(null, true)

    const ok =
      origin.includes("framer.app") ||
      origin.includes("framer.com") ||
      origin.includes("framer.website") ||
      origin.includes("framer.ai") ||
      origin.includes("framerusercontent.com") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")

    if (ok) return cb(null, true)
    return cb(new Error("Not allowed by CORS: " + origin))
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}

// ✅ 프리플라이트 포함
app.use(cors(corsOptions))
app.options("*", cors(corsOptions))

// ✅ 요청 들어오면 origin/method 찍어서 디버깅
app.use((req, res, next) => {
  console.log("[REQ]", req.method, req.path, "origin=", req.headers.origin)
  next()
})

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

// ✅ GET도 만들어서 배포됐는지 확인 쉽게
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

/**
 * ✅ 연결 테스트용: POST /api/dress
 * - 지금은 합성 없이 model_single을 그대로 output으로 돌려줌
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

    return res.json({
      ok: true,
      view: view || "front",
      output: model,
      debug: {
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
