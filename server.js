import express from "express"
import cors from "cors"
import Replicate from "replicate"
import { createCanvas, loadImage } from "canvas"

const app = express()

// ✅ CORS 확실히 열기 (Framer + 로컬 허용)
const corsOptions = {
  origin: (origin, cb) => {
    // origin이 없을 때(서버-서버 호출/헬스체크)는 허용
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

// ✅ 중요: dataUrl(base64) 페이로드 크니까 반드시 limit 올려야 함
app.use(express.json({ limit: "80mb" }))

app.get("/", (req, res) => {
  res.send("DRESSD server running")
})

app.get("/health", (req, res) => {
  res.json({ ok: true })
})

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

function withAdultGuard(prompt) {
  // ✅ 정책/안전: 성인 명시 + 나이 고정
  return `adult, age 25, ${prompt}`
}

/**
 * =========================
 * S1 (Imagen)
 * =========================
 */
app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body

  if (!process.env.REPLICATE_API_TOKEN) {
    return res
      .status(500)
      .json({ error: "REPLICATE_API_TOKEN missing on server" })
  }
  if (!prompt) {
    return res.status(400).json({ error: "Prompt missing" })
  }

  try {
    const finalPrompt = withAdultGuard(prompt)

    // ✅ 품질 개선 핵심:
    // - image_size: "2K"
    // - aspect_ratio: "9:16"
    // - output_format: "png"
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
 * =========================
 * Helpers (S3 composite)
 * =========================
 */
async function loadDataUrl(dataUrl) {
  // loadImage는 dataURL도 직접 로드 가능
  return await loadImage(dataUrl)
}

function num(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function normalizeArrange(a) {
  return {
    x: num(a?.x, 0), // px
    y: num(a?.y, 0), // px
    s: num(a?.s, 1), // scale
    r: num(a?.r, 0), // rotation deg
    o: num(a?.o, 1), // opacity
    anchor: a?.anchor || "center",
  }
}

function degToRad(d) {
  return (d * Math.PI) / 180
}

/**
 * =========================
 * S3 (Dress) - 2D Alpha Composite
 * =========================
 * - 모델(model_single) = 캔버스 베이스
 * - garments = arrange 좌표대로 drawImage
 * - 모델/옷 "변형 0" 목표에 가장 안전한 1단계
 */
app.post("/api/dress", async (req, res) => {
  try {
    const body = req.body || {}
    const view = body.view || "front"
    const files = body.files || {}

    const modelDataUrl = files.model_single
    if (!modelDataUrl) {
      return res.status(400).json({ error: "model_single missing" })
    }

    // ✅ arrange 우선순위:
    // 1) dressArrangeForView (Runner가 만들어서 보내는 view 전용)
    // 2) dressArrange.front/back
    const arrangeForView = body.dressArrangeForView || {}
    const dressArrange = body.dressArrange || {}
    const fallbackArrange =
      view === "front"
        ? (dressArrange.front || {})
        : (dressArrange.back || {})

    const arrange =
      Object.keys(arrangeForView).length > 0 ? arrangeForView : fallbackArrange

    // 1) 모델 로드
    const modelImg = await loadDataUrl(modelDataUrl)
    const W = modelImg.width
    const H = modelImg.height

    // 2) 캔버스 (✅ 모델 크기 기준)
    const canvas = createCanvas(W, H)
    const ctx = canvas.getContext("2d")
    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(modelImg, 0, 0, W, H)

    // 3) 레이어 순서 (원하면 나중에 DressPlan.tsx ORDER로 교체 가능)
    const LAYER_ORDER = [
      "shoes",
      "bottom",
      "top",
      "outer",
      "bag",
      "necklace",
      "bracelet",
      "ring",
      "earring",
      "hat",
    ]

    const viewSuffix = `_${view}` // "_front" | "_back"

    // 4) 합성
    for (const slot of LAYER_ORDER) {
      const key = `${slot}${viewSuffix}` // 예: top_front
      const garmentDataUrl = files[key]
      if (!garmentDataUrl) continue

      // arrange 없으면 스킵(강제)
      const aRaw = arrange[key]
      if (!aRaw) continue

      const a = normalizeArrange(aRaw)

      const garmentImg = await loadDataUrl(garmentDataUrl)
      const gw = garmentImg.width
      const gh = garmentImg.height

      const dw = gw * a.s
      const dh = gh * a.s

      // anchor: center 기준 (x,y가 중심좌표)
      const cx = a.x
      const cy = a.y

      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, a.o))
      ctx.translate(cx, cy)
      ctx.rotate(degToRad(a.r))
      ctx.drawImage(garmentImg, -dw / 2, -dh / 2, dw, dh)
      ctx.restore()
    }

    // 5) 결과 반환 (png)
    const outDataUrl = canvas.toDataURL("image/png")

    return res.json({
      dataUrl: outDataUrl,
      debug: {
        view,
        canvas: { W, H },
        receivedKeysCount: Object.keys(files).length,
        usedArrangeKeysCount: Object.keys(arrange || {}).length,
        usedArrangeKeys: Object.keys(arrange || {}),
      },
    })
  } catch (e) {
    return res.status(500).json({
      error: "Dress composite failed",
      detail: String(e?.message ?? e),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
