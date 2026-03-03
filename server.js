// server.js (FULL) — S1 filter + auto-regenerate (Replicate caption validator)
// ✅ Works with your current Render + Framer setup
// ✅ Keeps your “CORS 강제 통과” 방식 그대로
// ✅ Adds: validate(imageUrl) -> fail이면 자동 재생성(최대 N번)
// ✅ Validator는 Replicate 캡션 모델을 사용 (모델 슬러그는 ENV로 교체 가능)
//
// -----------------------------------------
// REQUIRED ENV
// - REPLICATE_API_TOKEN
//
// OPTIONAL ENV
// - PORT (Render가 자동으로 10000 주는 경우가 많음)
// - IMAGE_MODEL (default: google/imagen-4)
// - CAPTION_MODEL (default: salesforce/blip)  ⚠️ Replicate에서 안 맞으면 여기만 바꿔
// - S1_MAX_ATTEMPTS (default: 3)
// - S1_VALIDATION_STRICT (default: "1")  // 1=엄격, 0=느슨
// -----------------------------------------

import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ============================================================
 * ✅ 0) CORS (preflight 포함 강제 통과)
 * - Framer에서 보내는 X-Client-Id 헤더 때문에 preflight에서 막히는 케이스 대응
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

  if (req.method === "OPTIONS") return res.status(204).end()
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
  res.json({
    ok: true,
    version: "2026-03-04_s1_filter_autoregen_v1",
  })
)

/**
 * ============================================================
 * ✅ 1) TEST CREDITS (Reserve / Confirm / Release) — 인메모리
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

const wallets = new Map() // clientId -> { balance, reserved }
const reservations = new Map() // reservationId -> { clientId, amount, status, createdAt, meta }

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
  res.json({ clientId: cid, balance: w.balance, reserved: w.reserved })
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
 * ✅ 2) Replicate + S1 (Imagen) + Filter/Auto-regenerate
 * ============================================================
 */
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

const IMAGE_MODEL = process.env.IMAGE_MODEL || "google/imagen-4"

// ⚠️ CAPTION_MODEL 은 Replicate에서 “캡션 문자열”을 리턴하는 모델이면 됨.
//    만약 salesforce/blip가 안 먹히면 여기만 교체하면 됨.
const CAPTION_MODEL = process.env.CAPTION_MODEL || "salesforce/blip"

const S1_MAX_ATTEMPTS = Number(process.env.S1_MAX_ATTEMPTS || 3)
const S1_VALIDATION_STRICT = String(process.env.S1_VALIDATION_STRICT || "1") === "1"

function mustHaveToken(res) {
  if (!process.env.REPLICATE_API_TOKEN) {
    res.status(500).json({ error: "REPLICATE_API_TOKEN missing on server" })
    return false
  }
  return true
}

function withAdultGuard(prompt) {
  // ✅ 정책 안정: 성인 명시
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
  const output = await replicate.run(IMAGE_MODEL, {
    input: {
      prompt,
      image_size: "2K",
      aspect_ratio: "3:4",
      output_format: "png",
      // ✅ seed 옵션이 모델에서 지원하면 여기에 넣을 수 있음.
      // seed: 1234,
    },
  })
  return pickImageUrl(output)
}

/**
 * ------------------------------------------------------------
 * ✅ Validator: Replicate 캡션 모델로 이미지 설명문 생성 → 룰로 Reject
 * - “text_prompts”, poster, collage, grid, multi-panel 등 걸러내기
 * - view(front/back)도 캡션 기반으로 1차 체크
 * ------------------------------------------------------------
 */

// 캡션 모델 출력 형태는 모델마다 다를 수 있어서 최대한 유연하게 처리
function extractCaption(out) {
  if (!out) return ""
  if (typeof out === "string") return out
  if (Array.isArray(out)) {
    // 어떤 모델은 ["caption..."] 형태로 줌
    const s = out.find((x) => typeof x === "string")
    if (s) return s
  }
  // { caption: "..." } 같은 경우
  if (typeof out?.caption === "string") return out.caption
  if (typeof out?.text === "string") return out.text
  if (typeof out?.output === "string") return out.output
  return ""
}

// 캡션 만들기 (이미지 URL 입력)
async function captionImage(imageUrl) {
  try {
    const out = await replicate.run(CAPTION_MODEL, {
      input: {
        image: imageUrl,
        // 모델에 따라 task 파라미터가 필요할 수 있음.
        // task: "caption",
      },
    })
    return extractCaption(out).trim()
  } catch (e) {
    // 캡션이 실패하면 “검증 불가”
    return ""
  }
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function containsAny(text, list) {
  return list.some((w) => text.includes(w))
}

function validateByCaptionRules(captionRaw, expectedView /* "front" | "back" */) {
  const caption = normalize(captionRaw)

  // 캡션이 아예 안 나오면: 엄격 모드에서는 fail, 느슨 모드에서는 pass
  if (!caption) {
    return {
      ok: !S1_VALIDATION_STRICT,
      reason: S1_VALIDATION_STRICT ? "caption_failed" : "caption_missing_but_allowed",
    }
  }

  // 1) 텍스트/포스터/콜라주/그리드류 강력 차단
  const bannedHard = [
    "text",
    "words",
    "caption",
    "watermark",
    "logo",
    "poster",
    "flyer",
    "magazine",
    "brochure",
    "infographic",
    "diagram",
    "label",
    "screenshot",
    "collage",
    "grid",
    "panel",
    "comic",
    "meme",
    "title",
    "paragraph",
    "letter",
    "typography",
  ]
  if (containsAny(caption, bannedHard)) {
    return { ok: false, reason: "banned_overlay_or_layout" }
  }

  // 2) 사람/인물 여부(너무 엄격하게 하면 false reject 많아서 옵션 처리)
  // 엄격 모드: person/human이 안 잡히면 fail
  const personHints = ["person", "woman", "man", "female", "male", "human", "model"]
  if (S1_VALIDATION_STRICT && !containsAny(caption, personHints)) {
    return { ok: false, reason: "no_person_detected" }
  }

  // 3) view 일관성(캡션 기반)
  // - back인데 face/front/looking at camera 나오면 fail
  // - front인데 back/rear/from behind만 강하게 나오면 fail
  if (expectedView === "back") {
    const badForBack = ["face", "front view", "front-facing", "looking at camera", "portrait"]
    if (containsAny(caption, badForBack)) return { ok: false, reason: "view_mismatch_back" }
  } else {
    const badForFront = ["rear view", "back view", "from behind", "back-facing"]
    if (containsAny(caption, badForFront)) return { ok: false, reason: "view_mismatch_front" }
  }

  // 4) 멀티 인물 방지(캡션은 종종 부정확해서 “엄격 모드”에서만 적용)
  if (S1_VALIDATION_STRICT) {
    const multiHints = ["two people", "two persons", "group", "crowd", "several people"]
    if (containsAny(caption, multiHints)) return { ok: false, reason: "multiple_people" }
  }

  return { ok: true, reason: "ok" }
}

function attemptHint(attemptIndex) {
  // attemptIndex: 1..N
  // 재시도 때 프롬프트를 살짝 강화해서 “레이아웃/텍스트/콜라주” 방향으로 튀는 걸 억제
  const hard = [
    "NO TEXT",
    "NO POSTER",
    "NO MAGAZINE",
    "NO COLLAGE",
    "NO GRID",
    "NO PANELS",
    "NO WATERMARK",
    "NO TYPOGRAPHY",
    "single full-body studio photo only",
  ].join(", ")
  if (attemptIndex <= 1) return ""
  if (attemptIndex === 2) return `, ${hard}`
  return `, ${hard}, extremely clean plain background, no graphic design, no layout`
}

async function generateValidated(prompt, expectedView, maxAttempts = S1_MAX_ATTEMPTS) {
  let last = {
    url: null,
    caption: "",
    failReason: "",
    usedPrompt: "",
    attempt: 0,
  }

  for (let i = 1; i <= maxAttempts; i++) {
    const usedPrompt = `${prompt}${attemptHint(i)}`
    last.usedPrompt = usedPrompt
    last.attempt = i

    const url = await runImagen(usedPrompt)
    if (!url) {
      last.failReason = "no_image_url"
      continue
    }

    const cap = await captionImage(url)
    const verdict = validateByCaptionRules(cap, expectedView)

    last.url = url
    last.caption = cap
    last.failReason = verdict.ok ? "" : verdict.reason

    if (verdict.ok) {
      return {
        ok: true,
        url,
        caption: cap,
        usedPrompt,
        attempt: i,
        failReason: "",
      }
    }
  }

  return {
    ok: false,
    url: last.url,
    caption: last.caption,
    usedPrompt: last.usedPrompt,
    attempt: last.attempt,
    failReason: last.failReason || "validation_failed",
  }
}

/**
 * ✅ /api/s1 (FRONT 1장)
 * body:
 *  - { prompt: string }
 *  - or legacy fields are ignored
 */
app.post("/api/s1", async (req, res) => {
  if (!mustHaveToken(res)) return

  const prompt = String(req.body?.prompt || "").trim()
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

  try {
    const base = withAdultGuard(prompt)
    const locked = withViewLock(base, "front")

    const out = await generateValidated(locked, "front", S1_MAX_ATTEMPTS)
    if (!out.ok) {
      return res.status(502).json({
        error: "Validation failed after retries",
        failReason: out.failReason,
        lastUrl: out.url,
        lastCaption: out.caption,
        usedPrompt: out.usedPrompt,
        attempts: out.attempt,
      })
    }

    return res.json({
      imageUrl: out.url,
      usedPrompt: out.usedPrompt,
      caption: out.caption,
      attempts: out.attempt,
    })
  } catch (e) {
    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

/**
 * ✅ /api/s1/pair (FRONT+BACK 2장)
 * body:
 *  - { prompt: string }
 *  - or { promptFront: string, promptBack: string }  // 프론트에서 이미 만들었다면 그대로 받음
 *
 * NOTE:
 *  - 너 지금 payload에 promptFront / promptBack을 보내고 있었음 (스크린샷 기준)
 *  - 그래서 여기서 둘 다 지원하도록 안정화
 */
app.post("/api/s1/pair", async (req, res) => {
  if (!mustHaveToken(res)) return

  const prompt = String(req.body?.prompt || "").trim()
  const promptFrontIn = String(req.body?.promptFront || "").trim()
  const promptBackIn = String(req.body?.promptBack || "").trim()

  // ✅ 최소 하나는 있어야 함
  if (!prompt && !promptFrontIn && !promptBackIn) {
    return res.status(400).json({ error: "Prompt missing (need prompt or promptFront/promptBack)" })
  }

  try {
    let promptFront = promptFrontIn
    let promptBack = promptBackIn

    // prompt만 넘어오면 서버에서 front/back으로 만든다
    if (prompt && (!promptFront || !promptBack)) {
      const base = withAdultGuard(prompt)
      promptFront = withViewLock(base, "front")
      promptBack = withViewLock(base, "back")
    }

    // ✅ 순차 실행(안정)
    const front = await generateValidated(promptFront, "front", S1_MAX_ATTEMPTS)
    if (!front.ok) {
      return res.status(502).json({
        error: "Front validation failed after retries",
        failReason: front.failReason,
        lastUrl: front.url,
        lastCaption: front.caption,
        usedPromptFront: front.usedPrompt,
        attemptsFront: front.attempt,
      })
    }

    const back = await generateValidated(promptBack, "back", S1_MAX_ATTEMPTS)
    if (!back.ok) {
      return res.status(502).json({
        error: "Back validation failed after retries",
        failReason: back.failReason,
        lastUrl: back.url,
        lastCaption: back.caption,
        usedPromptBack: back.usedPrompt,
        attemptsBack: back.attempt,
      })
    }

    return res.json({
      frontUrl: front.url,
      backUrl: back.url,

      usedPromptFront: front.usedPrompt,
      usedPromptBack: back.usedPrompt,

      captionFront: front.caption,
      captionBack: back.caption,

      aspect_ratio: "3:4",
      attemptsFront: front.attempt,
      attemptsBack: back.attempt,
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
 * ✅ 3) S3 Dress (FASHN) — 그대로 유지
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
      const imageUrl = Array.isArray(output)
        ? output[0]
        : typeof output === "string"
        ? output
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
