// server.js
import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

// ✅ CORS: Framer + 로컬
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
app.use(express.json({ limit: "25mb" })) // ✅ dataUrl이 커질 수 있어서 넉넉히

app.get("/", (req, res) => {
  res.send("DRESSD server running")
})

app.get("/health", (req, res) => {
  res.json({ ok: true })
})

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

// ✅ S1 (이미 쓰던 것 유지)
function withAdultGuard(prompt) {
  return `adult, age 25, ${prompt}`
}

app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body

  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({ error: "REPLICATE_API_TOKEN missing on server" })
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
 * ==========================================================
 * ✅ S3: Dress (Virtual Try-on)
 * - Replicate IDM-VTON 사용
 * - 입력 스키마: human_img, garm_img, category, crop, steps, seed... :contentReference[oaicite:1]{index=1}
 * ==========================================================
 */

// ✅ 특정 버전 고정 (테스트 안정성)
const IDM_VTON_VERSION =
  "cuuupid/idm-vton:3b032a70c29aef7b9c3222f2e40b71660201d8c288336475ba326f3ca278a3e1"

// ✅ category 자동 결정: 일단 S3는 "상의/아우터" 중심으로 upper_body가 기본
function normalizeCategory(v) {
  const x = String(v ?? "").trim()
  if (x === "upper_body" || x === "lower_body" || x === "dresses") return x
  return "upper_body"
}

// GET으로 때리면 힌트 주기 (너가 브라우저로 확인하던 그 용도)
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

app.post("/api/dress", async (req, res) => {
  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({ ok: false, error: "REPLICATE_API_TOKEN missing on server" })
  }

  const body = req.body ?? {}
  const view = (body.view === "back" ? "back" : "front")

  /**
   * ✅ 우리가 받는 payload 규격(클라에서 맞춰줄 것)
   * {
   *   view: "front" | "back",
   *   model: "<dataUrl or url string>",
   *   garments: [{ key: "top_front", dataUrl: "<dataUrl or url>" , category?: "upper_body" }],
   *   category?: "upper_body" | "lower_body" | "dresses",
   *   crop?: boolean,
   *   steps?: number,
   *   seed?: number,
   *   storeId?: string,
   *   clientTime?: number
   * }
   */

  const model = body.model
  const garments = Array.isArray(body.garments) ? body.garments : []

  // ✅ model validation
  if (!model || typeof model !== "string") {
    return res.status(400).json({
      ok: false,
      error: "model missing",
      hint: "Expected body.model as dataUrl string OR URL string",
      gotBodyKeys: Object.keys(body),
      gotModelType: typeof model,
    })
  }

  // ✅ garment validation (지금은 1개만 먼저 제대로 만들자)
  if (!garments.length) {
    return res.status(400).json({
      ok: false,
      error: "garments missing",
      hint: "Expected body.garments as array with at least one item {dataUrl}",
      gotGarmentsType: typeof body.garments,
    })
  }

  const g0 = garments[0] ?? {}
  const garm_img = g0.dataUrl
  if (!garm_img || typeof garm_img !== "string") {
    return res.status(400).json({
      ok: false,
      error: "garment[0].dataUrl missing",
      hint: "Expected garments[0].dataUrl as dataUrl string OR URL string",
      gotGarment0Keys: Object.keys(g0),
      gotGarmType: typeof garm_img,
    })
  }

  // ✅ category: body 우선, 없으면 garment item, 최종 upper_body
  const category = normalizeCategory(body.category ?? g0.category)

  // ✅ crop: 모델이 3:4가 아닐 수 있으니 기본 true 권장(테스트 안정)
  const crop = typeof body.crop === "boolean" ? body.crop : true

  // ✅ steps: 기본 30 (Replicate schema default 30, 20~40) :contentReference[oaicite:2]{index=2}
  let steps = Number.isFinite(body.steps) ? Number(body.steps) : 30
  steps = Math.max(20, Math.min(40, steps))

  // ✅ seed: 고정하면 재현성이 좋아짐
  const seed = Number.isFinite(body.seed) ? Number(body.seed) : 42

  try {
    // ✅ Replicate run
    const outputUrl = await replicate.run(IDM_VTON_VERSION, {
      input: {
        human_img: model,     // :contentReference[oaicite:3]{index=3}
        garm_img: garm_img,   // :contentReference[oaicite:4]{index=4}
        category,             // :contentReference[oaicite:5]{index=5}
        crop,                 // :contentReference[oaicite:6]{index=6}
        steps,                // :contentReference[oaicite:7]{index=7}
        seed,                 // :contentReference[oaicite:8]{index=8}
      },
    })

    // outputUrl은 string(URI) 형태 :contentReference[oaicite:9]{index=9}
    if (!outputUrl || typeof outputUrl !== "string") {
      return res.status(502).json({
        ok: false,
        error: "No outputUrl returned",
        output: outputUrl,
      })
    }

    return res.json({
      ok: true,
      view,
      category,
      outputUrl,
      debug: {
        crop,
        steps,
        seed,
        storeId: body.storeId ?? null,
        clientTime: body.clientTime ?? null,
      },
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
