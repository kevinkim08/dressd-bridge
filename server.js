// server.js (FINAL+ - filter + auto-regenerate + underwear lock + debug safe)
import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ============================================================
 * ✅ 0) Hard CORS (preflight 포함 강제 통과)
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

// (보조) cors 패키지도 유지
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

/**
 * ============================================================
 * ✅ Body parser (500의 1순위 원인 = req.body undefined/empty)
 * ============================================================
 */
app.use(express.json({ limit: "25mb" }))
app.use(express.urlencoded({ extended: true, limit: "25mb" }))

/**
 * ============================================================
 * ✅ Fetch 폴백 (Node 18+는 기본 내장, 안전하게 한번 더)
 * ============================================================
 */
const _fetch = globalThis.fetch
  ? globalThis.fetch.bind(globalThis)
  : async (...args) => {
      const mod = await import("node-fetch")
      return mod.default(...args)
    }

/**
 * ============================================================
 * ✅ 1) Health
 * ============================================================
 */
app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    version: "2026-03-04_final_pair_credits_filter_autoregen_underwearlock_v1",
  })
)

/**
 * ============================================================
 * ✅ 2) TEST CREDITS (Reserve / Confirm / Release) - In-Memory
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

// clientId -> { balance, reserved }
const wallets = new Map()
// reservationId -> { clientId, amount, status, createdAt, meta, reason }
const reservations = new Map()

function ensureWallet(clientId) {
  if (!wallets.has(clientId)) {
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
  res.json({
    clientId: cid,
    balance: w.balance,
    reserved: w.reserved,
    available: w.balance - w.reserved,
  })
})

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
 * ✅ 3) Replicate / Imagen + Filter + Auto-regenerate
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

function withAdultGuard(prompt) {
  return `adult, age 25, ${prompt}`
}

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
      "rear view only",
      "camera directly behind subject",
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
    "front-facing only",
    "camera directly in front of subject",
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

// ✅ pair에서 front/back 언더웨어 컬러/스타일 맞추는 “공통 잠금”
const ENABLE_UNDERWEAR_LOCK = process.env.ENABLE_UNDERWEAR_LOCK !== "0"
const UNDERWEAR_LOCK_PROMPT = [
  "wearing plain solid-color underwear only",
  "underwear color consistent between all views",
  "same underwear color front and back",
  "no pattern, no logo",
].join(", ")

// ✅ (중요) ‘큰 가슴’이 back에서 터지는 걸 막는 back 전용 안정화 힌트
// - “앞에서 크다”를 줘도, back에선 “측면 돌출”로 과장되는 경우가 있어
// - 그래서 back에는 “natural silhouette / not exaggerated / no side bulge”를 추가
const BACK_BUST_SAFETY_HINTS = [
  "natural back silhouette",
  "no exaggerated chest protrusion",
  "no unnatural side bulge",
  "realistic anatomy",
].join(", ")

// Replicate output 형태 안전 추출
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
 * ============================================================
 * ✅ 3-1) Result Filter (캡션 기반)
 *
 * - “이상한 결과(텍스트 잔뜩/콜라주/패널/그리드/포스터 같은)”를 걸러냄
 * - Replicate로 이미지 캡션을 뽑아서 룰 기반 판정
 *
 * ⚙️ 토글:
 *   ENABLE_RESULT_FILTER=1  (기본 ON)
 *   CAPTION_MODEL_VERSION=... (필요 시)
 * ============================================================
 */
const ENABLE_RESULT_FILTER = process.env.ENABLE_RESULT_FILTER !== "0"

// 기본 캡션 모델(바뀔 수 있으니 env로 교체 가능하게)
const CAPTION_MODEL_VERSION =
  process.env.CAPTION_MODEL_VERSION || "salesforce/blip:2e1dddc8621f72155f24cf2e0adbde548458d3cab9f00c0139c1a7fe2a1b3b3f"

// blip output normalize
function normalizeCaption(out) {
  if (!out) return ""
  if (typeof out === "string") return out
  if (Array.isArray(out)) return String(out[0] ?? "")
  if (out?.caption) return String(out.caption)
  if (out?.text) return String(out.text)
  return ""
}

async function captionImage(imageUrl) {
  if (!ENABLE_RESULT_FILTER) return { caption: "", model: "disabled" }
  try {
    const out = await replicate.run(CAPTION_MODEL_VERSION, {
      input: {
        image: imageUrl,
      },
    })
    return { caption: normalizeCaption(out), model: CAPTION_MODEL_VERSION }
  } catch (e) {
    // 캡션 모델 실패해도 생성 자체는 살려야 함 (필터는 best-effort)
    return { caption: "", model: "caption_failed" }
  }
}

function looksBadByCaption(caption) {
  const c = String(caption || "").toLowerCase()
  if (!c) return false

  // 텍스트/포스터/콜라주류
  const badTokens = [
    "text",
    "words",
    "letters",
    "typography",
    "poster",
    "magazine",
    "newspaper",
    "book cover",
    "brochure",
    "flyer",
    "infographic",
    "diagram",
    "collage",
    "grid",
    "panel",
    "split",
    "multi",
    "multiple",
    "two people",
    "group",
    "crowd",
    "close up",
    "portrait",
    "headshot",
    "upper body",
  ]

  for (const t of badTokens) {
    if (c.includes(t)) return true
  }

  return false
}

// (선택) 프롬프트상 “금지어”가 결과에 들어간 느낌이면 컷
function looksBadByHeuristicPromptUsed(usedPrompt) {
  const p = String(usedPrompt || "").toLowerCase()
  // 프롬프트가 너무 길어서 깨짐/이상출력 나는 케이스 방지
  if (p.length > 6000) return true
  return false
}

async function isObviouslyBadResult(imageUrl, usedPrompt) {
  if (!ENABLE_RESULT_FILTER) return { bad: false, why: "filter_disabled", caption: "" }

  // 1) 캡션 기반
  const cap = await captionImage(imageUrl)
  const caption = cap.caption || ""

  const badByCaption = looksBadByCaption(caption)
  const badByPrompt = looksBadByHeuristicPromptUsed(usedPrompt)

  if (badByCaption) return { bad: true, why: "bad_caption", caption }
  if (badByPrompt) return { bad: true, why: "bad_prompt_heuristic", caption }

  return { bad: false, why: "ok", caption }
}

async function generateWithRetry(prompt, maxRetry = 1) {
  let last = { url: null, tries: 0, warned: false, caption: "", badWhy: "" }
  let lastErr = null

  for (let i = 0; i <= maxRetry; i++) {
    try {
      const url = await runImagen(prompt)
      if (!url) throw new Error("No imageUrl in output")

      const check = await isObviouslyBadResult(url, prompt)
      last = {
        url,
        tries: i + 1,
        warned: check.bad,
        caption: check.caption || "",
        badWhy: check.why || "",
      }

      if (!check.bad) return last
      // bad면 자동 재생성
    } catch (e) {
      lastErr = e
    }
  }

  if (last.url) return last
  throw lastErr || new Error("Generation failed")
}

/**
 * ✅ credits helper
 */
async function confirmIfReserved(req, reservationId) {
  const cid = getClientId(req)
  if (!cid || !reservationId) return
  const r = reservations.get(reservationId)
  if (!r) return
  if (r.clientId !== cid) return
  if (r.status !== "reserved") return

  const w = ensureWallet(cid)
  w.reserved = Math.max(0, w.reserved - r.amount)
  w.balance = Math.max(0, w.balance - r.amount)
  r.status = "confirmed"
  reservations.set(reservationId, r)
}

async function releaseIfReserved(req, reservationId) {
  const cid = getClientId(req)
  if (!cid || !reservationId) return
  const r = reservations.get(reservationId)
  if (!r) return
  if (r.clientId !== cid) return
  if (r.status !== "reserved") return

  const w = ensureWallet(cid)
  w.reserved = Math.max(0, w.reserved - r.amount)
  r.status = "released"
  reservations.set(reservationId, r)
}

/**
 * ============================================================
 * ✅ 3-2) Debug helpers (500 원인 추적)
 * ============================================================
 */
function rid() {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`
}
function safeKeys(obj) {
  try {
    return Object.keys(obj || {})
  } catch {
    return []
  }
}

/**
 * ============================================================
 * ✅ /api/s1 (FRONT 1장)
 * ============================================================
 */
app.post("/api/s1", async (req, res) => {
  const requestId = rid()
  const { prompt, reservationId } = req.body || {}

  if (!mustHaveToken(res)) return
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

  try {
    const base = withAdultGuard(prompt)
    const lockedPrompt = withViewLock(base, "front")

    const out = await generateWithRetry(lockedPrompt, 2) // ✅ 필터 있으면 2회까지 재생성 권장

    await confirmIfReserved(req, reservationId)

    return res.json({
      requestId,
      imageUrl: out.url,
      usedPrompt: lockedPrompt,
      tries: out.tries,
      filter: ENABLE_RESULT_FILTER ? { warned: out.warned, badWhy: out.badWhy, caption: out.caption } : { enabled: false },
    })
  } catch (e) {
    await releaseIfReserved(req, reservationId)
    console.error(`[${requestId}] /api/s1 ERROR`, e?.stack || e)
    return res.status(500).json({
      requestId,
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

/**
 * ============================================================
 * ✅ /api/s1/pair (FRONT+BACK 2장)
 *
 * ✅ 바디 호환:
 * - (A) { prompt } 만 와도 됨  → 서버가 front/back 잠금 프롬프트 생성
 * - (B) { promptFront, promptBack } 오면 우선 사용
 *
 * ✅ 추가:
 * - underwear lock (front/back 컬러 일치)
 * - back bust safety hints (과장 방지)
 * ============================================================
 */
app.post("/api/s1/pair", async (req, res) => {
  const requestId = rid()
  const b = req.body || {}
  const reservationId = b.reservationId

  if (!mustHaveToken(res)) return

  const hasPairPrompts = typeof b.promptFront === "string" && typeof b.promptBack === "string"
  const hasSinglePrompt = typeof b.prompt === "string"

  if (!hasPairPrompts && !hasSinglePrompt) {
    return res.status(400).json({
      requestId,
      error: "Prompt missing",
      hint: "Send {prompt} OR {promptFront, promptBack}",
      gotKeys: safeKeys(b),
    })
  }

  try {
    let promptFront = ""
    let promptBack = ""

    if (hasPairPrompts) {
      promptFront = String(b.promptFront)
      promptBack = String(b.promptBack)
    } else {
      const base = withAdultGuard(String(b.prompt))
      promptFront = withViewLock(base, "front")
      promptBack = withViewLock(base, "back")
    }

    // ✅ underwear lock (원하면 끌 수 있음)
    if (ENABLE_UNDERWEAR_LOCK) {
      promptFront = `${promptFront}, ${UNDERWEAR_LOCK_PROMPT}`
      promptBack = `${promptBack}, ${UNDERWEAR_LOCK_PROMPT}`
    }

    // ✅ back에서 “가슴 과장/측면 돌출”이 터지는 케이스 완화
    // - 특히 “큰 가슴” 프롬프트가 들어가 있으면 back에서 과장될 확률↑
    // - back 쪽에만 안전문구 추가 (front는 원하는 볼륨을 살려야 하니까)
    promptBack = `${promptBack}, ${BACK_BUST_SAFETY_HINTS}`

    // ✅ 생성(필터 포함 자동 재생성)
    const front = await generateWithRetry(promptFront, 2)
    const back = await generateWithRetry(promptBack, 2)

    if (!front?.url || !back?.url) {
      await releaseIfReserved(req, reservationId)
      return res.status(502).json({
        requestId,
        error: "No imageUrl in output",
        frontUrl: front?.url || null,
        backUrl: back?.url || null,
      })
    }

    await confirmIfReserved(req, reservationId)

    return res.json({
      requestId,
      frontUrl: front.url,
      backUrl: back.url,
      usedPromptFront: promptFront,
      usedPromptBack: promptBack,
      aspect_ratio: "3:4",
      triesFront: front.tries,
      triesBack: back.tries,
      filter: ENABLE_RESULT_FILTER
        ? {
            front: { warned: front.warned, badWhy: front.badWhy, caption: front.caption },
            back: { warned: back.warned, badWhy: back.badWhy, caption: back.caption },
          }
        : { enabled: false },
    })
  } catch (e) {
    await releaseIfReserved(req, reservationId)
    console.error(`[${requestId}] /api/s1/pair ERROR`, {
      message: e?.message ?? String(e),
      stack: e?.stack,
      gotKeys: safeKeys(b),
      hasPairPrompts,
      hasSinglePrompt,
    })
    return res.status(500).json({
      requestId,
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

/**
 * ============================================================
 * ✅ 4) S3 Dress (FASHN)
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
    Authorization: `Bearer ${key}`,
  }
}

app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress or GET /api/dress/:id" })
})

app.post("/api/dress", async (req, res) => {
  const requestId = rid()
  try {
    const { view = "front", model, garments = {} } = req.body || {}

    if (!isDataUrl(model)) {
      return res.status(400).json({ requestId, error: "model must be a dataUrl (data:image/...)" })
    }
    const garment = pickGarment(view, garments)
    if (!isDataUrl(garment)) {
      return res.status(400).json({
        requestId,
        error: "garment missing. Need top_front/top_back (dataUrl)",
      })
    }

    const body = {
      model_name: FASHN_MODEL_NAME,
      inputs: {
        model_image: model,
        garment_image: garment,
      },
    }

    const r = await _fetch(`${FASHN_BASE}/run`, {
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
        requestId,
        error: json?.error || `FASHN /run failed: HTTP ${r.status} ${text.slice(0, 500)}`,
      })
    }

    const predictionId = json?.id
    if (!predictionId) {
      return res.status(502).json({ requestId, error: "FASHN /run returned no id", raw: json })
    }

    return res.status(202).json({ requestId, predictionId, status: json?.status || "starting" })
  } catch (e) {
    console.error(`[${requestId}] /api/dress ERROR`, e?.stack || e)
    return res.status(500).json({ requestId, error: String(e?.message ?? e) })
  }
})

app.get("/api/dress/:id", async (req, res) => {
  const requestId = rid()
  try {
    const id = req.params.id

    const r = await _fetch(`${FASHN_BASE}/status/${id}`, { headers: fashnHeaders() })
    const text = await r.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}

    if (!r.ok) {
      return res.status(r.status).json({
        requestId,
        error: json?.error || `FASHN /status failed: HTTP ${r.status} ${text.slice(0, 500)}`,
      })
    }

    const status = json?.status

    if (status === "completed") {
      const output = json?.output
      const imageUrl =
        Array.isArray(output)
          ? output[0]
          : typeof output === "string"
          ? output
          : output?.image || output?.image_url || output?.url

      if (!imageUrl) {
        return res.status(502).json({ requestId, error: "No imageUrl in output", raw: json })
      }

      return res.json({ requestId, predictionId: id, status: "succeeded", imageUrl })
    }

    if (["starting", "in_queue", "processing"].includes(status)) {
      return res.status(202).json({ requestId, predictionId: id, status })
    }

    return res.status(500).json({
      requestId,
      predictionId: id,
      status,
      error: json?.error || "prediction failed",
    })
  } catch (e) {
    console.error(`[${requestId}] /api/dress/:id ERROR`, e?.stack || e)
    return res.status(500).json({ requestId, error: String(e?.message ?? e) })
  }
})

/**
 * ============================================================
 * ✅ Start
 * ============================================================
 */
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
