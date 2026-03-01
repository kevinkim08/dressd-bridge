// server.js (ESM)
import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ✅ CORS
 * - framer preview/production 도메인, 로컬 허용
 * - Render health check 같은 origin 없는 요청도 허용
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
app.options("*", cors(corsOptions)) // ✅ preflight 안정화
app.use(express.json({ limit: "25mb" })) // ✅ dataUrl 길어서 넉넉히

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

/**
 * ✅ helper: garments object에서 첫번째 이미지 뽑기
 * - { "top_front": "data:image/...", "outer_front": "data:image/..." } 형태
 */
function pickFirstGarment(garments) {
  if (!garments || typeof garments !== "object") return null
  const keys = Object.keys(garments)
  for (const k of keys) {
    const v = garments[k]
    if (typeof v === "string" && (v.startsWith("data:image/") || v.startsWith("http"))) {
      return { key: k, value: v }
    }
  }
  return null
}

app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

/**
 * ✅ POST /api/dress
 * body:
 * {
 *   view: "front" | "back",
 *   model: "data:image/..." | "https://...",
 *   garments: { [key:string]: "data:image/..." | "https://..." },
 *   clientTime?: number,
 *   storeId?: string
 * }
 */
app.post("/api/dress", async (req, res) => {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ ok: false, error: "REPLICATE_API_TOKEN missing on server" })
    }

    const { view, model, garments } = req.body || {}

    // ✅ 모델 필수
    if (!model || typeof model !== "string") {
      return res.status(400).json({
        ok: false,
        error: "model missing",
        hint: "Expected body.model as dataUrl string OR {dataUrl} string",
        gotBodyKeys: Object.keys(req.body || {}),
      })
    }

    // ✅ 의류 1개라도 있어야 진짜 try-on 의미가 있음
    const picked = pickFirstGarment(garments)
    if (!picked) {
      return res.status(400).json({
        ok: false,
        error: "garment missing",
        hint: "Expected body.garments as object with at least 1 image (dataUrl or http url)",
        gotGarmentsKeys: garments ? Object.keys(garments) : [],
      })
    }

    // ✅ idm-vton 입력 구성
    // - Replicate 모델 페이지의 input schema: human_img, garm_img, garment_des ... :contentReference[oaicite:2]{index=2}
    const human_img = model
    const garm_img = picked.value

    // 아주 단순한 설명(나중에 너희 S3DressPrompt에서 정교화 가능)
    const garment_des =
      picked.key.includes("top") ? "top" :
      picked.key.includes("bottom") ? "bottom" :
      picked.key.includes("outer") ? "outerwear" :
      "garment"

    const output = await replicate.run(
      // ✅ idm-vton (cuuupid)
      "cuuupid/idm-vton:3b032a70c29aef7b9c3222f2e40b71660201d8c288336475ba326f3ca278a3e1",
      {
        input: {
          human_img,
          garm_img,
          garment_des,
          // mask_img: optional
        },
      }
    )

    // Replicate output 형태가 모델마다 달라서 유연하게 처리
    const imageUrl =
      Array.isArray(output)
        ? (output[0]?.url ? output[0].url() : output[0])
        : (output?.url ? output.url() : output)

    if (!imageUrl) {
      return res.status(502).json({
        ok: false,
        error: "No imageUrl in output",
        output,
      })
    }

    return res.json({
      ok: true,
      view: view ?? null,
      usedGarmentKey: picked.key,
      imageUrl,
    })
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Dress generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
