import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

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
  allowedHeaders: ["Content-Type", "Authorization"],
}

app.use(cors(corsOptions))
app.options("*", cors(corsOptions))
app.use(express.json({ limit: "25mb" }))

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

/** -------------------------
 *  S1 (Replicate) 그대로 유지
 *  ------------------------- */
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

function withAdultGuard(prompt) {
  return `adult, age 25, ${prompt}`
}

app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body
  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({ error: "REPLICATE_API_TOKEN missing on server" })
  }
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

  try {
    const finalPrompt = withAdultGuard(prompt)
    const output = await replicate.run("google/imagen-4", {
      input: {
        prompt: finalPrompt,
        image_size: "2K",
        aspect_ratio: "3:4",
        output_format: "png",
      },
    })

    const imageUrl = Array.isArray(output)
      ? output[0]?.url ? output[0].url() : output[0]
      : output?.url ? output.url() : output

    if (!imageUrl) {
      return res.status(502).json({ error: "No imageUrl in output", output })
    }
    return res.json({ imageUrl, usedPrompt: finalPrompt })
  } catch (e) {
    return res.status(500).json({ error: "Generation failed", detail: String(e?.message ?? e) })
  }
})

/** -------------------------
 *  S3 Dress (FASHN) 붙이기
 *  ------------------------- */

const FASHN_BASE = "https://api.fashn.ai/v1"
const FASHN_MODEL_NAME = "tryon-v1.6" // 문서 예시 모델명 :contentReference[oaicite:5]{index=5}

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
    "Authorization": `Bearer ${key}`, // 문서 방식 :contentReference[oaicite:6]{index=6}
  }
}

// 안내용
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress or GET /api/dress/:id" })
})

// 1) 합성 시작
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

    // FASHN: POST /v1/run, model_name + inputs :contentReference[oaicite:7]{index=7}
    const body = {
      model_name: FASHN_MODEL_NAME,
      inputs: {
        model_image: model,
        garment_image: garment,
        // (추가 옵션은 나중에. 일단 파이프라인 성공부터)
      },
    }

    const r = await fetch(`${FASHN_BASE}/run`, {
      method: "POST",
      headers: fashnHeaders(),
      body: JSON.stringify(body),
    })

    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch {}

    if (!r.ok) {
      return res.status(r.status).json({
        error: json?.error || `FASHN /run failed: HTTP ${r.status} ${text.slice(0, 500)}`,
      })
    }

    // 문서 예시: runData.id가 predictionId :contentReference[oaicite:8]{index=8}
    const predictionId = json?.id
    if (!predictionId) {
      return res.status(502).json({ error: "FASHN /run returned no id", raw: json })
    }

    return res.status(202).json({ predictionId, status: json?.status || "starting" })
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) })
  }
})

// 2) 결과 폴링
app.get("/api/dress/:id", async (req, res) => {
  try {
    const id = req.params.id

    // FASHN: GET /v1/status/<ID> :contentReference[oaicite:9]{index=9}
    const r = await fetch(`${FASHN_BASE}/status/${id}`, { headers: fashnHeaders() })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch {}

    if (!r.ok) {
      return res.status(r.status).json({
        error: json?.error || `FASHN /status failed: HTTP ${r.status} ${text.slice(0, 500)}`,
      })
    }

    const status = json?.status

    // 문서 예시: completed면 output 확인 :contentReference[oaicite:10]{index=10}
    if (status === "completed") {
      const output = json?.output
      // output 형태는 케이스별로 다를 수 있어서 "첫 이미지 URL"만 뽑아주자
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

    // 실패/기타
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
