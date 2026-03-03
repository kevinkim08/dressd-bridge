import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ============================================================
 * ✅ 0) CORS (가장 확실한 방식: preflight 포함 강제 통과)
 * ============================================================
 */
app.use((req, res, next) => {
  const origin = req.headers.origin

  const ok =
    !origin ||
    origin.includes("framer.app") ||
    origin.includes("framer.com") ||
    origin.includes("framercanvas.com") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1")

  if (ok && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Vary", "Origin")
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")

  // ✅ 핵심: 브라우저가 요청한 헤더를 그대로 허용 (x-client-id 포함)
  const reqHeaders = req.headers["access-control-request-headers"]
  res.setHeader(
    "Access-Control-Allow-Headers",
    reqHeaders || "Content-Type, Authorization, X-Client-Id, x-client-id"
  )

  if (req.method === "OPTIONS") {
    return res.status(204).end()
  }
  next()
})

// (보조) cors 패키지도 같이 둬도 됨
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
  allowedHeaders: ["Content-Type", "Authorization", "X-Client-Id", "x-client-id"],
}
app.use(cors(corsOptions))

app.use(express.json({ limit: "25mb" }))

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) =>
  res.json({ ok: true, version: "2026-03-03_working_base_plus_safe_retry_v1" })
)

/**
 * ============================================================
 * ✅ 1) TEST CREDITS (Reserve / Confirm / Release)
 * ============================================================
 */

function getClientId(req) {
  const v =
    req.header("X-Client-Id") ||
    req.header("x-client-id") ||
    req.header("X-CLIENT-ID") ||
    ""
  return String(v || "").trim()
}

function requireClientId(req, res) {
  const cid = getClientId(req)
  if (!cid) {
    res.status(400).json({ error: "Missing X-Client-Id" })
    return null
  }
  return cid
}

// 인메모리 지갑
const wallets = new Map() // clientId -> { balance, reserved }
const reservations = new Map() // reservationId -> { clientId, amount, status, createdAt, meta }

function ensureWallet(clientId) {
  if (!wallets.has(clientId)) {
    // ✅ 테스트 기본 크레딧
    wallets.set(clientId, { balance: 9999, reserved: 0 })
  }
  return wallets.get(clientId)
}

function makeReservationId() {
  return `r_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

app.get("/api/credits/balance", (req, res) => {
  const cid = requireClientId(req, res)
  if (!cid) return
  const w = ensureWallet(cid)
  res.json({ clientId: cid, balance: w.balance, reserved: w.reserved })
})

/**
 * POST /api/credits/reserve
 * body: { amount: number, reason?: string, meta?: any }
 */
app.post("/api/credits/reserve", (req, res) => {
  const cid = requireClientId(req, res)
  if (!cid) return

  const amount = Number(req.body?.amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" })
  }

  const w = ensureWallet(cid)
  const available = w.balance - w.reserved

  if (available < amount) {
    return res.status(402).json({
      error: "Insufficient credits",
      balance: w.balance,
      reserved: w.reserved,
      available,
      need: amount,
    })
  }

  const reservationId = makeReservationId()
  w.reserved += amount

  reservations.set(reservationId, {
    clientId: cid,
    amount,
    status: "reserved",
    createdAt: Date.now(),
    meta: req.body?.meta ?? null,
    reason: req.body?.reason ?? null,
  })

  return res.json({
    ok: true,
    reservationId,
    balance: w.balance,
    reserved: w.reserved,
    available: w.balance - w.reserved,
  })
})

/**
 * POST /api/credits/confirm
 * body: { reservationId: string }
 */
app.post("/api/credits/confirm", (req, res) => {
  const cid = requireClientId(req, res)
  if (!cid) return

  const reservationId = String(req.body?.reservationId ?? "")
  const r = reservations.get(reservationId)
  if (!r) return res.status(404).json({ error: "Reservation not found" })
  if (r.clientId !== cid) return res.status(403).json({ error: "Forbidden" })
  if (r.status !== "reserved") {
    return res.status(400).json({ error: `Bad status: ${r.status}` })
  }

  const w = ensureWallet(cid)
  w.reserved = Math.max(0, w.reserved - r.amount)
  w.balance = Math.max(0, w.balance - r.amount)

  r.status = "confirmed"
  reservations.set(reservationId, r)

  return res.json({
    ok: true,
    reservationId,
    balance: w.balance,
    reserved: w.reserved,
    available: w.balance - w.reserved,
  })
})

/**
 * POST /api/credits/release
 * body: { reservationId: string }
 */
app.post("/api/credits/release", (req, res) => {
  const cid = requireClientId(req, res)
  if (!cid) return

  const reservationId = String(req.body?.reservationId ?? "")
  const r = reservations.get(reservationId)
  if (!r) return res.status(404).json({ error: "Reservation not found" })
  if (r.clientId !== cid) return res.status(403).json({ error: "Forbidden" })
  if (r.status !== "reserved") {
    return res.status(400).json({ error: `Bad status: ${r.status}` })
  }

  const w = ensureWallet(cid)
  w.reserved = Math.max(0, w.reserved - r.amount)

  r.status = "released"
  reservations.set(reservationId, r)

  return res.json({
    ok: true,
    reservationId,
    balance: w.balance,
    reserved: w.reserved,
    available: w.balance - w.reserved,
  })
})

/**
 * ============================================================
 * ✅ 2) S1 (Replicate / Imagen)
 * - ✅ "원본 동작" 유지
 * - ✅ 최소 변경: prompt key 유연화 + 안전 재시도 + 결과가 "이미지인지"만 확인
 * ============================================================
 */
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

function mustHaveToken(res) {
  if (!process.env.REPLICATE_API_TOKEN) {
    res.status(500).json({ error: "REPLICATE_API_TOKEN missing on server" })
    return false
  }
  return true
}

// ✅ 프론트가 prompt 키를 다르게 보내도 서버가 받아줌 (400 방지)
function pickPromptFromBody(body) {
  const p =
    body?.prompt ||
    body?.finalPrompt ||
    body?.positivePrompt ||
    body?.positive ||
    ""
  return String(p || "").trim()
}

function withAdultGuard(prompt) {
  return `adult, age 25, ${prompt}`
}

/**
 * ✅ back 머리 쏠림 완화용 (옵션)
 */
function hairConsistencyHints() {
  return [
    "hair centered",
    "symmetrical hairstyle",
    "hair not swept to one side",
    "no wind",
    "no dramatic motion",
  ].join(", ")
}

function withViewLock(prompt, view) {
  if (view === "back") {
    return [
      prompt,
      "back view only",
      "rear view",
      "standing straight",
      "symmetrical posture",
      "full body",
      "head to toe",
      "feet visible",
      "not front view",
      "single person",
      "centered",
      hairConsistencyHints(),
    ].join(", ")
  }
  return [
    prompt,
    "front view only",
    "front-facing",
    "standing straight",
    "symmetrical posture",
    "full body",
    "head to toe",
    "feet visible",
    "not back view",
    "single person",
    "centered",
    hairConsistencyHints(),
  ].join(", ")
}

function pickImageUrl(output) {
  if (Array.isArray(output)) {
    const first = output[0]
    if (!first) return null
    if (typeof first === "string") return first
    if (typeof first?.url === "function") return first.url()
    if (typeof first?.url === "string") return first.url
    return null
  }
  if (typeof output === "string") return output
  if (output && typeof output?.url === "function") return output.url()
  if (output && typeof output?.url === "string") return output.url
  return null
}

async function runImagen(prompt) {
  const output = await replicate.run("google/imagen-4", {
    input: {
      prompt,
      image_size: "2K",
      aspect_ratio: "3:4",
      output_format: "png",
    },
  })
  return pickImageUrl(output)
}

/**
 * ✅ "거르기"를 무겁게 하면 바로 깨지니까,
 *    지금은 진짜 최소로: URL이 "이미지"로 응답되는지만 확인.
 * - HEAD가 막히는 CDN도 있어서: Range GET으로 1~2KB만 읽음
 */
async function looksLikeImageUrl(url) {
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-2047" },
    })
    if (!r.ok) return false
    const ct = (r.headers.get("content-type") || "").toLowerCase()
    if (ct.includes("image/")) return true
    // content-type이 안 주어지는 경우도 있어서 바이트로 대충 체크(너무 엄격하게 하면 오탐)
    const buf = await r.arrayBuffer()
    return buf.byteLength > 16
  } catch {
    return false
  }
}

async function generateWithRetry(prompt, maxRetry = 1) {
  let lastUrl = null
  let lastOkImage = false
  let lastErr = null

  for (let i = 0; i <= maxRetry; i++) {
    try {
      const url = await runImagen(prompt)
      if (!url) throw new Error("No imageUrl in output")
      lastUrl = url

      // ✅ 최소 검증: 이미지로 열리는지
      const ok = await looksLikeImageUrl(url)
      lastOkImage = ok
      if (ok) return { url, tries: i + 1 }
      // 이미지가 아니면 재시도
    } catch (e) {
      lastErr = e
    }
  }

  // 재시도 끝나도 마지막 결과는 반환 (warned)
  if (lastUrl) return { url: lastUrl, tries: maxRetry + 1, warned: true, okImage: lastOkImage }
  throw lastErr || new Error("Generation failed")
}

// ✅ /api/s1 (FRONT 1장)
app.post("/api/s1", async (req, res) => {
  const prompt = pickPromptFromBody(req.body)
  if (!mustHaveToken(res)) return
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

  try {
    const base = withAdultGuard(prompt)
    const lockedPrompt = withViewLock(base, "front")

    const out = await generateWithRetry(lockedPrompt, 1)
    return res.json({
      imageUrl: out.url,
      usedPrompt: lockedPrompt,
      tries: out.tries,
      warned: !!out.warned,
      okImage: out.okImage !== false, // undefined면 true처럼 취급
    })
  } catch (e) {
    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

// ✅ /api/s1/pair (FRONT+BACK 2장)
app.post("/api/s1/pair", async (req, res) => {
  const prompt = pickPromptFromBody(req.body)
  if (!mustHaveToken(res)) return
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

  try {
    const base = withAdultGuard(prompt)

    const promptFront = withViewLock(base, "front")
    const promptBack = withViewLock(base, "back")

    const front = await generateWithRetry(promptFront, 1)
    const back = await generateWithRetry(promptBack, 1)

    if (!front?.url || !back?.url) {
      return res.status(502).json({
        error: "No imageUrl in output",
        frontUrl: front?.url || null,
        backUrl: back?.url || null,
      })
    }

    return res.json({
      frontUrl: front.url,
      backUrl: back.url,
      usedPromptFront: promptFront,
      usedPromptBack: promptBack,
      aspect_ratio: "3:4",
      triesFront: front.tries,
      triesBack: back.tries,
      warnedFront: !!front.warned,
      warnedBack: !!back.warned,
    })
  } catch (e) {
    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

/**
 * ============================================================
 * ✅ 3) S3 Dress (FASHN)
 * ============================================================
 */
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
    "Authorization": `Bearer ${key}`,
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
    try { json = JSON.parse(text) } catch {}

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
    try { json = JSON.parse(text) } catch {}

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
