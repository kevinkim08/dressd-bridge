// server.js (FINAL+++ - bootsafe + credits + hard CORS + S1 pair + 429 handling + E005 safe-fallback + filter best-effort)
// ✅ Requires Node 18+ (Render에서 Node 버전 고정 추천)
import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ============================================================
 * ✅ 0) Boot safety: Node version check
 * ============================================================
 */
const nodeMajor = Number(String(process.versions.node || "0").split(".")[0] || 0)
if (nodeMajor < 18) {
  console.error(
    `[BOOT] Node ${process.versions.node} detected. This server requires Node 18+. ` +
      `Fix Render setting or package.json engines.`
  )
}

/**
 * ============================================================
 * ✅ 1) Hard CORS (preflight 포함 강제 통과)
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

  // ✅ 핵심: 브라우저가 preflight에서 요청한 헤더를 그대로 허용
  const reqHeaders = req.headers["access-control-request-headers"]
  res.setHeader(
    "Access-Control-Allow-Headers",
    reqHeaders || "Content-Type, Authorization, X-Client-Id, x-client-id"
  )

  if (req.method === "OPTIONS") return res.status(204).end()
  next()
})

// (보조) cors 패키지도 유지
app.use(
  cors({
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
  })
)

/**
 * ============================================================
 * ✅ 2) Body parser (req.body 비는 문제 방지)
 * ============================================================
 */
app.use(express.json({ limit: "25mb" }))
app.use(express.urlencoded({ extended: true, limit: "25mb" }))

/**
 * ============================================================
 * ✅ 3) Health
 * ============================================================
 */
app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    version: "2026-03-04_finalppp_bootsafe_filter_429_e005_v1",
    node: process.versions.node,
  })
)

/**
 * ============================================================
 * ✅ 4) TEST CREDITS (Reserve / Confirm / Release) - In-Memory
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
  if (!wallets.has(clientId)) wallets.set(clientId, { balance: 9999, reserved: 0 })
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
 * ✅ 5) Replicate / Imagen + Filter (best-effort) + 429/E005 helpers
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

function withAdultGuard(prompt) {
  return `adult, age 25, ${prompt}`
}

/**
 * ✅ back 머리 쏠림 확률 낮추는 힌트
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

// ✅ FRONT/BACK 뷰 고정
function withViewLock(prompt, view) {
  if (view === "back") {
    return [
      prompt,
      "back view only",
      "rear view only",
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

// ✅ pair에서 front/back 베이스레이어(기본 착장) 컬러/스타일 맞추는 “공통 잠금”
// - "underwear only" 같은 표현은 안전필터(E005)에 걸릴 확률↑
// - base layer로 포장 + modest / non-lingerie로 안전화
const ENABLE_BASE_LAYER_LOCK = process.env.ENABLE_UNDERWEAR_LOCK !== "0" // 기존 env 그대로 호환
const BASE_LAYER_LOCK_PROMPT = [
  "wearing simple seamless base layer shorts and a basic fitted base-layer top (non-sheer)",
  "consistent base-layer color across all views",
  "solid color, no logo, no pattern",
  "modest, non-revealing, non-lingerie",
].join(", ")

// ✅ back에서 “가슴 과장/측면 돌출” 완화(Back만)
const BACK_BUST_SAFETY_HINTS = [
  "natural back silhouette",
  "no exaggerated chest protrusion",
  "no unnatural side bulge",
  "realistic anatomy",
].join(", ")

// ✅ Filter toggle
const ENABLE_RESULT_FILTER = process.env.ENABLE_RESULT_FILTER !== "0"

// ✅ 캡션 모델(바뀔 수 있으니 env로 교체 가능)
const CAPTION_MODEL_VERSION =
  process.env.CAPTION_MODEL_VERSION ||
  "salesforce/blip:2e1dddc8621f72155f24cf2e0adbde548458d3cab9f00c0139c1a7fe2a1b3b3f"

// ✅ Replicate output 형태 안전 추출
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
 * ✅ 5-1) 429 Too Many Requests helpers
 * ============================================================
 */
function isRateLimitError(err) {
  const msg = String(err?.message || "")
  return (
    err?.status === 429 ||
    err?.response?.status === 429 ||
    msg.includes("429") ||
    msg.toLowerCase().includes("too many requests") ||
    msg.toLowerCase().includes("throttled") ||
    msg.toLowerCase().includes("rate limit")
  )
}

function parseRetryAfterSeconds(err) {
  // Replicate ApiError: message에 JSON이 포함되는 케이스
  try {
    const msg = String(err?.message || "")
    const i = msg.indexOf("{")
    if (i >= 0) {
      const j = JSON.parse(msg.slice(i))
      if (j?.retry_after && Number.isFinite(Number(j.retry_after))) return Number(j.retry_after)
    }
  } catch {}

  // 기본
  return 6
}

/**
 * ============================================================
 * ✅ 5-2) E005 sensitive-flag helpers
 * ============================================================
 */
function isSensitiveFlagError(err) {
  const msg = String(err?.message || "")
  return msg.includes("(E005)") || msg.toLowerCase().includes("flagged as sensitive")
}

// E005 폴백용: 위험 단어를 "base layer"로 완화 + modest 강화
function makeSaferPrompt(p) {
  const s = String(p || "")
  return (
    s
      .replace(/underwear\s*only/gi, "modest base layer")
      .replace(/underwear/gi, "base layer")
      .replace(/lingerie/gi, "base layer")
      .replace(/\s+/g, " ")
      .trim() + ", modest, non-revealing, non-sheer, not lingerie"
  )
}

/**
 * ============================================================
 * ✅ 5-3) Result Filter (caption based) - best-effort
 * ============================================================
 */
function normalizeCaption(out) {
  if (!out) return ""
  if (typeof out === "string") return out
  if (Array.isArray(out)) return String(out[0] ?? "")
  if (out?.caption) return String(out.caption)
  if (out?.text) return String(out.text)
  return ""
}

async function captionImageBestEffort(imageUrl) {
  if (!ENABLE_RESULT_FILTER) return { caption: "", model: "disabled" }
  try {
    const out = await replicate.run(CAPTION_MODEL_VERSION, { input: { image: imageUrl } })
    return { caption: normalizeCaption(out), model: CAPTION_MODEL_VERSION }
  } catch {
    // 캡션 실패해도 생성은 살림
    return { caption: "", model: "caption_failed" }
  }
}

function looksBadByCaption(caption) {
  const c = String(caption || "").toLowerCase()
  if (!c) return false

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

  return badTokens.some((t) => c.includes(t))
}

async function checkBadBestEffort(imageUrl, usedPrompt) {
  if (!ENABLE_RESULT_FILTER) return { bad: false, why: "filter_disabled", caption: "" }

  // 프롬프트 길이 이상치 방어
  if (String(usedPrompt || "").length > 6000) {
    return { bad: true, why: "bad_prompt_heuristic", caption: "" }
  }

  const cap = await captionImageBestEffort(imageUrl)
  const caption = cap.caption || ""

  if (looksBadByCaption(caption)) return { bad: true, why: "bad_caption", caption }

  return { bad: false, why: "ok", caption }
}

async function generateWithRetry(prompt, maxRetry = 1) {
  let last = { url: null, tries: 0, warned: false, caption: "", badWhy: "" }
  let lastErr = null

  for (let i = 0; i <= maxRetry; i++) {
    try {
      const url = await runImagen(prompt)
      if (!url) throw new Error("No imageUrl in output")

      const check = await checkBadBestEffort(url, prompt)
      last = {
        url,
        tries: i + 1,
        warned: check.bad,
        caption: check.caption || "",
        badWhy: check.why || "",
      }

      if (!check.bad) return last
      // bad면 재생성
    } catch (e) {
      lastErr = e
      // 429/E005는 여기서 억지로 반복해도 소용 없을 수 있어서,
      // 라우트에서 정책적으로 처리하는 게 더 낫다.
      if (isRateLimitError(e) || isSensitiveFlagError(e)) break
    }
  }

  if (last.url) return last
  throw lastErr || new Error("Generation failed")
}

/**
 * ============================================================
 * ✅ 6) S1 endpoints
 * ============================================================
 */

// ✅ /api/s1 (FRONT 1장)
app.post("/api/s1", async (req, res) => {
  const requestId = rid()
  const { prompt, reservationId } = req.body || {}

  if (!mustHaveToken(res)) return
  if (!prompt) return res.status(400).json({ requestId, error: "Prompt missing" })

  try {
    const base = withAdultGuard(prompt)
    const lockedPrompt = withViewLock(base, "front")

    // 단일 1장: 필터/재생성 2회까지 허용
    const out = await generateWithRetry(lockedPrompt, 2)

    await confirmIfReserved(req, reservationId)

    return res.json({
      requestId,
      imageUrl: out.url,
      usedPrompt: lockedPrompt,
      tries: out.tries,
      filter: ENABLE_RESULT_FILTER
        ? { warned: out.warned, badWhy: out.badWhy, caption: out.caption }
        : { enabled: false },
    })
  } catch (e) {
    await releaseIfReserved(req, reservationId)

    if (isRateLimitError(e)) {
      const retryAfterSeconds = parseRetryAfterSeconds(e)
      console.error(`[${requestId}] /api/s1 429`, { retryAfterSeconds, message: e?.message })
      return res.status(429).json({
        requestId,
        error: "RATE_LIMITED",
        retryAfterSeconds,
        detail: String(e?.message ?? e),
      })
    }

    if (isSensitiveFlagError(e)) {
      console.error(`[${requestId}] /api/s1 E005`, { message: e?.message })
      return res.status(422).json({
        requestId,
        error: "SENSITIVE_FLAGGED",
        code: "E005",
        detail: String(e?.message ?? e),
      })
    }

    console.error(`[${requestId}] /api/s1 ERROR`, e?.stack || e)
    return res.status(500).json({
      requestId,
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

/**
 * ✅ /api/s1/pair (FRONT+BACK 2장)
 *
 * ✅ 바디 호환:
 * - (A) { prompt } 만 와도 됨  → 서버가 front/back 잠금 프롬프트 생성
 * - (B) { promptFront, promptBack } 오면 우선 사용
 *
 * ✅ 추가:
 * - base layer lock (front/back 컬러 일치, underwear 표현 제거)
 * - back bust safety hints (과장 방지)
 * - 429는 429로 내려서 프론트가 retryAfter 기반 재시도 가능
 * - E005는 safePrompt로 "1회만" 폴백 재시도 후 실패 시 422 반환
 */
app.post("/api/s1/pair", async (req, res) => {
  const requestId = rid()
  const b = req.body || {}
  const reservationId = b.reservationId

  if (!mustHaveToken(res)) return

  const hasPairPrompts =
    typeof b.promptFront === "string" && typeof b.promptBack === "string"
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

    // ✅ base layer lock (기본 ON)
    if (ENABLE_BASE_LAYER_LOCK) {
      promptFront = `${promptFront}, ${BASE_LAYER_LOCK_PROMPT}`
      promptBack = `${promptBack}, ${BASE_LAYER_LOCK_PROMPT}`
    }

    // ✅ back 가슴 과장 완화(Back만)
    promptBack = `${promptBack}, ${BACK_BUST_SAFETY_HINTS}`

    // ✅ pair는 호출 수가 많아 rate limit 민감
    // - 기본은 retry 0 (필터로 bad 판정되어도 재생성 안함)
    // - 개발 중이라면 여기서 1로 올릴 수도 있지만 429 더 잘 터짐
    const PAIR_RETRY = Number(process.env.PAIR_RETRY ?? 0)

    let front = null
    let back = null

    try {
      front = await generateWithRetry(promptFront, PAIR_RETRY)
      back = await generateWithRetry(promptBack, PAIR_RETRY)
    } catch (e) {
      // 429는 즉시 위로
      if (isRateLimitError(e)) throw e

      // E005면 "안전 프롬프트"로 1회만 폴백
      if (isSensitiveFlagError(e)) {
        const safeFront = makeSaferPrompt(promptFront)
        const safeBack = makeSaferPrompt(promptBack)

        front = await generateWithRetry(safeFront, 0)
        back = await generateWithRetry(safeBack, 0)

        // usedPrompt도 safe로 내려서 디버깅 가능하게
        promptFront = safeFront
        promptBack = safeBack
      } else {
        throw e
      }
    }

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

    // ✅ 429는 429로 반환 (프론트가 retryAfter 후 재시도 가능)
    if (isRateLimitError(e)) {
      const retryAfterSeconds = parseRetryAfterSeconds(e)
      console.error(`[${requestId}] /api/s1/pair 429`, {
        retryAfterSeconds,
        message: e?.message ?? String(e),
      })
      return res.status(429).json({
        requestId,
        error: "RATE_LIMITED",
        retryAfterSeconds,
        detail: String(e?.message ?? e),
      })
    }

    // ✅ E005가 폴백에서도 터지면 422로 반환
    if (isSensitiveFlagError(e)) {
      console.error(`[${requestId}] /api/s1/pair E005`, { message: e?.message ?? String(e) })
      return res.status(422).json({
        requestId,
        error: "SENSITIVE_FLAGGED",
        code: "E005",
        detail: String(e?.message ?? e),
      })
    }

    console.error(`[${requestId}] /api/s1/pair ERROR`, {
      message: e?.message ?? String(e),
      stack: e?.stack,
      gotKeys: safeKeys(b),
      hasPairPrompts: typeof b.promptFront === "string" && typeof b.promptBack === "string",
      hasSinglePrompt: typeof b.prompt === "string",
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
 * ✅ Start
 * ============================================================
 */
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
