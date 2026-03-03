import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

// ✅ Node 18+ 는 fetch 기본 제공.
// Render/로컬에서 Node 버전이 낮아 fetch가 없으면 에러나니까 안전장치.
if (typeof globalThis.fetch !== "function") {
  console.warn(
    "[WARN] fetch is not available. Use Node 18+ or add a fetch polyfill (undici/node-fetch)."
  )
}

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    const ok =
      origin.includes("framer.app") ||
      origin.includes("framer.com") ||
      origin.includes("framercanvas.com") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")
    if (ok) return cb(null, true)
    return cb(new Error("Not allowed by CORS: " + origin))
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Client-Id"],
}

app.use(cors(corsOptions))
app.options("*", cors(corsOptions))
app.use(express.json({ limit: "25mb" }))

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

/** -------------------------
 *  S1 (Replicate / Imagen)
 *  ------------------------- */
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

function mustHaveToken(res) {
  if (!process.env.REPLICATE_API_TOKEN) {
    res.status(500).json({ error: "REPLICATE_API_TOKEN missing on server" })
    return false
  }
  return true
}

function withAdultGuard(prompt) {
  // 안전장치(성인 고정)
  return `adult, age 25, ${prompt}`
}

// ✅ FRONT/BACK 뷰 고정 + 구도 고정 + back hair 안정화
function withViewLock(prompt, view) {
  if (view === "back") {
    return [
      prompt,

      // 방향 고정
      "strict back view only",
      "rear view only",
      "camera directly behind subject",
      "subject facing away from camera",
      "no face visible",
      "no three-quarter angle",
      "no side angle",
      "not front view",

      // 구도 고정
      "full body shot",
      "head to toe",
      "feet fully visible",
      "wide framing",
      "not cropped",
      "not close-up",
      "not portrait",
      "single person",
      "centered",

      // ✅ 헤어 안정화(쏠림/바람 방지)
      "hair centered",
      "hair falling straight down the back",
      "symmetrical hairstyle",
      "no wind",
      "no motion",
      "no hair over one shoulder",
      "no dynamic hair movement",
    ].join(", ")
  }

  // default front
  return [
    prompt,

    // 방향 고정
    "strict front view only",
    "camera directly in front",
    "subject facing camera",
    "not back view",

    // 구도 고정
    "full body shot",
    "head to toe",
    "feet fully visible",
    "wide framing",
    "not cropped",
    "not close-up",
    "not portrait",
    "single person",
    "centered",
  ].join(", ")
}

// ✅ Replicate output 형태가 케이스별로 달라서 최대한 안전하게 뽑기
function pickImageUrl(output) {
  // 1) 배열 형태
  if (Array.isArray(output)) {
    const first = output[0]
    if (!first) return null
    if (typeof first === "string") return first
    if (typeof first?.url === "function") return first.url()
    if (typeof first?.url === "string") return first.url
    return null
  }

  // 2) 단일 string url
  if (typeof output === "string") return output

  // 3) object with url() or url
  if (output && typeof output?.url === "function") return output.url()
  if (output && typeof output?.url === "string") return output.url

  return null
}

async function runImagen(prompt) {
  const output = await replicate.run("google/imagen-4", {
    input: {
      prompt,
      image_size: "2K",
      aspect_ratio: "3:4", // ✅ 3:4 고정
      output_format: "png",
    },
  })
  return pickImageUrl(output)
}

/**
 * ✅ 최소 검증(1차)
 * - URL 없음/동일 이미지면 실패로 간주
 * - (BLIP 같은 정밀 검증은 다음 단계에서)
 */
function basicValidatePair(frontUrl, backUrl) {
  if (!frontUrl || !backUrl) return false
  if (frontUrl === backUrl) return false
  return true
}

/**
 * ✅ 자동 재생성(최대 N회)
 * - front/back 둘 다 생성
 * - 검증 실패면 재시도
 */
async function generatePairWithRetry(promptFront, promptBack, maxRetry = 2) {
  let last = { frontUrl: null, backUrl: null }
  for (let attempt = 1; attempt <= maxRetry + 1; attempt++) {
    const frontUrl = await runImagen(promptFront)
    const backUrl = await runImagen(promptBack)
    last = { frontUrl, backUrl }

    if (basicValidatePair(frontUrl, backUrl)) {
      return { ok: true, attempt, frontUrl, backUrl }
    }
  }
  return { ok: false, attempt: maxRetry + 1, ...last }
}

// ✅ 기존 엔드포인트 유지: /api/s1 (FRONT 1장만)
app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body || {}
  if (!mustHaveToken(res)) return
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

  try {
    const base = withAdultGuard(prompt)
    const lockedPrompt = withViewLock(base, "front")

    const imageUrl = await runImagen(lockedPrompt)
    if (!imageUrl) return res.status(502).json({ error: "No imageUrl in output" })

    return res.json({
      imageUrl,
      usedPrompt: lockedPrompt,
      aspect_ratio: "3:4",
    })
  } catch (e) {
    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

// ✅ 신규 엔드포인트: /api/s1/pair (FRONT+BACK 2장 생성 + 재시도)
app.post("/api/s1/pair", async (req, res) => {
  const { prompt } = req.body || {}
  if (!mustHaveToken(res)) return
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

  try {
    const base = withAdultGuard(prompt)
    const promptFront = withViewLock(base, "front")
    const promptBack = withViewLock(base, "back")

    // ✅ 재시도 포함
    const out = await generatePairWithRetry(promptFront, promptBack, 2)

    if (!out.ok) {
      return res.status(502).json({
        error: "Invalid image output after retry",
        attempt: out.attempt,
        frontUrl: out.frontUrl || null,
        backUrl: out.backUrl || null,
        usedPromptFront: promptFront,
        usedPromptBack: promptBack,
        aspect_ratio: "3:4",
      })
    }

    return res.json({
      frontUrl: out.frontUrl,
      backUrl: out.backUrl,
      attempt: out.attempt,
      usedPromptFront: promptFront,
      usedPromptBack: promptBack,
      aspect_ratio: "3:4",
    })
  } catch (e) {
    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

/** -------------------------
 *  S3 Dress (FASHN)
 *  ------------------------- */
const FASHN_BASE = "https://api.fashn.ai/v1"
const FASHN_MODEL_NAME = "tryon-v1.6"

function isDataUrl(v) {
  return typeof v === "string" && v.startsWith("data:image/")
}

function pickGarment(view, garments) {
  const primary = view === "back" ? "top_back" : "top_front"
  const fallback = view === "back" ? "top_front" : "top_back"
  return garments?.[primary] || garments?.[fallback] || ""
}

function fashnHeaders() {
  const key = process.env.FASHN_API_KEY
  if (!key) throw new Error("FASHN_API_KEY missing on server")
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  }
}

app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress or GET /api/dress/:id" })
})

app.post("/api/dress", async (req, res) => {
  try {
    const { view = "front", model, garments = {} } = req.body || {}

    if (!isDataUrl(model)) {
      return res.status(400).json({ error: "model must be a dataUrl (data:image/...)" })
    }
    const garment = pickGarment(view, garments)
    if (!isDataUrl(garment)) {
      return res.status(400).json({ error: "garment missing. Need top_front/top_back (dataUrl)" })
    }

    const body = {
      model_name: FASHN_MODEL_NAME,
      inputs: {
        model_image: model,
        garment_image: garment,
      },
    }

    const r = await fetch(`${FASHN_BASE}/run`, {
      method: "POST",
      headers: fashnHeaders(),
      body: JSON.stringify(body),
    })

    const text = await r.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}

    if (!r.ok) {
      return res.status(r.status).json({
        error: json?.error || `FASHN /run failed: HTTP ${r.status} ${text.slice(0, 500)}`,
      })
    }

    const predictionId = json?.id
    if (!predictionId) {
      return res.status(502).json({ error: "FASHN /run returned no id", raw: json })
    }

    return res.status(202).json({ predictionId, status: json?.status || "starting" })
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) })
  }
})

app.get("/api/dress/:id", async (req, res) => {
  try {
    const id = req.params.id

    const r = await fetch(`${FASHN_BASE}/status/${id}`, { headers: fashnHeaders() })
    const text = await r.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}

    if (!r.ok) {
      return res.status(r.status).json({
        error: json?.error || `FASHN /status failed: HTTP ${r.status} ${text.slice(0, 500)}`,
      })
    }

    const status = json?.status

    if (status === "completed") {
      const output = json?.output
      const imageUrl =
        Array.isArray(output) ? output[0]
        : typeof output === "string" ? output
        : output?.image || output?.image_url || output?.url

      if (!imageUrl) {
        return res.status(502).json({ error: "No imageUrl in output", raw: json })
      }

      return res.json({ predictionId: id, status: "succeeded", imageUrl })
    }

    if (["starting", "in_queue", "processing"].includes(status)) {
      return res.status(202).json({ predictionId: id, status })
    }

    return res.status(500).json({
      predictionId: id,
      status,
      error: json?.error || "prediction failed",
    })
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
