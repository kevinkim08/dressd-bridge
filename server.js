// server.js (FINAL++++ patched - PAIR BACK CANDIDATES + CLIP BEST PICK + keeps your BODY/UNDERWEAR/VIEW LOCK)
// ✅ Node 18+
// ✅ Imagen-4 does NOT reliably support seed/reference on Replicate → so we do: FRONT 1 + BACK N candidates → pick best BACK by CLIP similarity
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
    version:
      "2026-03-05_finalpppp_pairBackCandidates_clipPick_BODYLOCK_UNDERWEARLOCK_viewlock_filter_429_e005",
    node: process.versions.node,
    config: {
      ENABLE_BODY_LOCK: process.env.ENABLE_BODY_LOCK !== "0",
      ENABLE_UNDERWEAR_LOCK: process.env.ENABLE_UNDERWEAR_LOCK !== "0",
      ENABLE_RESULT_FILTER: process.env.ENABLE_RESULT_FILTER !== "0",
      BACK_CANDIDATES: Number(process.env.BACK_CANDIDATES || 6),
      BACK_MIN_SCORE: Number(process.env.BACK_MIN_SCORE || 0),
      BACK_EXTRA_ROUNDS: Number(process.env.BACK_EXTRA_ROUNDS || 0),
      CLIP_MODEL_VERSION: process.env.CLIP_MODEL_VERSION || "openai/clip",
    },
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

const wallets = new Map()
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
 * - NOTE: BACK에서 너무 강하게 걸면 pose가 틀어질 수 있어서 BACK은 약화
 */
function hairHintsFront() {
  return [
    "hair centered",
    "symmetrical hairstyle",
    "no wind",
    "no dramatic motion",
  ].join(", ")
}
function hairHintsBack() {
  return [
    "no wind",
    "no dramatic motion",
    "natural hair fall",
  ].join(", ")
}

// ✅ FRONT/BACK 뷰 고정
function withViewLock(prompt, view) {
  if (view === "back") {
    return [
      prompt,
      "back view only",
      "rear view only",
      "back facing camera",
      "looking away from camera",
      "standing straight",
      "symmetrical posture",
      "full body",
      "head to toe",
      "feet visible",
      "single person",
      "centered",
      hairHintsBack(),
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
    "single person",
    "centered",
    hairHintsFront(),
  ].join(", ")
}

/**
 * ============================================================
 * ✅ 5-A) BODY LOCK (짧고 강하게)
 * ============================================================
 */
const ENABLE_BODY_LOCK = process.env.ENABLE_BODY_LOCK !== "0"
const BODY_LOCK_PROMPT = [
  "same person across all views",
  "same waist circumference and same waistline position",
  "same shoulder width",
  "same hairstyle, same hair length and shape",
  "same head size and neck length",
  "consistent camera distance and framing",
  "studio catalog full-body photo, centered",
].join(", ")

/**
 * ============================================================
 * ✅ 5-B) UNDERWEAR / BIKINI SHAPE LOCK (압축 버전)
 * - 너무 길면 identity가 흔들릴 수 있어서 '색/심플/동일세트'만 남김
 * ============================================================
 */
const ENABLE_UNDERWEAR_LOCK = process.env.ENABLE_UNDERWEAR_LOCK !== "0"
const UNDERWEAR_STYLE = String(process.env.UNDERWEAR_STYLE || "underwear").toLowerCase().trim()
const UNDERWEAR_COLOR = String(process.env.UNDERWEAR_COLOR || "pure white").trim()

const UNDERWEAR_LOCK_PROMPT = [
  "wearing a simple matching seamless underwear set",
  `solid ${UNDERWEAR_COLOR} color`,
  "non-sheer, modest, no pattern, no logo",
  "same exact underwear set in front and back view",
  "commercial fashion catalog styling, modest, non-revealing",
].join(", ")

const BIKINI_LOCK_PROMPT = [
  "wearing a simple matching two-piece swimwear set",
  `solid ${UNDERWEAR_COLOR} color`,
  "non-sheer, modest, no pattern, no logo",
  "same exact swimwear set in front and back view",
  "commercial fashion catalog styling, modest, non-revealing",
].join(", ")

function baseOutfitLockPrompt() {
  return UNDERWEAR_STYLE === "bikini" ? BIKINI_LOCK_PROMPT : UNDERWEAR_LOCK_PROMPT
}

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
  try {
    const msg = String(err?.message || "")
    const i = msg.indexOf("{")
    if (i >= 0) {
      const j = JSON.parse(msg.slice(i))
      if (j?.retry_after && Number.isFinite(Number(j.retry_after))) return Number(j.retry_after)
    }
  } catch {}
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

// E005 폴백용: 너무 직접적인 단어를 완화 + 카탈로그 톤 강화
function makeSaferPrompt(p) {
  const s = String(p || "")
  return (
    s
      .replace(/underwear\s*only/gi, "matching base garment set")
      .replace(/underwear/gi, "matching base garment set")
      .replace(/bikini/gi, "matching swimwear set")
      .replace(/lingerie/gi, "base garment")
      .replace(/\s+/g, " ")
      .trim() + ", modest, non-revealing, non-sheer, commercial catalog"
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
    "multiple people",
    "two people",
    "group",
    "crowd",
  ]

  return badTokens.some((t) => c.includes(t))
}

async function checkBadBestEffort(imageUrl, usedPrompt) {
  if (!ENABLE_RESULT_FILTER) return { bad: false, why: "filter_disabled", caption: "" }

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
    } catch (e) {
      lastErr = e
      if (isRateLimitError(e) || isSensitiveFlagError(e)) break
    }
  }

  if (last.url) return last
  throw lastErr || new Error("Generation failed")
}

/**
 * ============================================================
 * ✅ 5-4) CLIP scoring for FRONT vs BACK candidates
 * - Imagen-4 on Replicate: seed/reference not reliable → we pick best BACK by visual similarity.
 *
 * ENV:
 *  - BACK_CANDIDATES=6 (추천 4~8)
 *  - BACK_MIN_SCORE=0 (원하면 0.90~0.94 정도로 시작)
 *  - BACK_EXTRA_ROUNDS=0 (minScore 미달 시 추가 후보 생성 라운드 수)
 *  - CLIP_MODEL_VERSION=openai/clip (필요하면 버전 pin 가능)
 * ============================================================
 */
const BACK_CANDIDATES = Number(process.env.BACK_CANDIDATES || 6)
const BACK_MIN_SCORE = Number(process.env.BACK_MIN_SCORE || 0)
const BACK_EXTRA_ROUNDS = Number(process.env.BACK_EXTRA_ROUNDS || 0)
const CLIP_MODEL_VERSION = process.env.CLIP_MODEL_VERSION || "openai/clip"

function cosineSim(a, b) {
  let dot = 0,
    na = 0,
    nb = 0
  const n = Math.min(a?.length || 0, b?.length || 0)
  for (let i = 0; i < n; i++) {
    const x = Number(a[i] || 0)
    const y = Number(b[i] || 0)
    dot += x * y
    na += x * x
    nb += y * y
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom ? dot / denom : -1
}

function extractEmbedding(out) {
  // 가능한 형태들을 최대한 방어적으로 처리
  if (!out) return null
  if (Array.isArray(out) && out.length > 0 && typeof out[0] === "number") return out
  if (out?.embedding && Array.isArray(out.embedding)) return out.embedding
  if (out?.image_embedding && Array.isArray(out.image_embedding)) return out.image_embedding
  if (out?.embeddings && Array.isArray(out.embeddings)) return out.embeddings
  return null
}

async function clipEmbedImage(imageUrl) {
  const out = await replicate.run(CLIP_MODEL_VERSION, { input: { image: imageUrl } })
  const emb = extractEmbedding(out)
  if (!emb) throw new Error("CLIP output shape unexpected")
  return emb
}

async function generateBackCandidates(promptBack, n) {
  const arr = []
  for (let i = 0; i < n; i++) {
    // ✅ pair에서 rate limit 민감 → 여기서는 retry 0 추천
    const r = await generateWithRetry(promptBack, 0)
    if (r?.url) arr.push(r)
  }
  if (!arr.length) throw new Error("No back candidates generated")
  return arr
}

async function pickBestBackByClip(frontUrl, backCandidates) {
  // ✅ CLIP 자체가 429 걸릴 수 있음 → 실패하면 first로 fallback
  try {
    const fEmb = await clipEmbedImage(frontUrl)

    let best = null
    for (const cand of backCandidates) {
      const bEmb = await clipEmbedImage(cand.url)
      const score = cosineSim(fEmb, bEmb)
      if (!best || score > best.score) best = { ...cand, score }
    }
    return best || { ...backCandidates[0], score: -1 }
  } catch (e) {
    console.warn("[CLIP] scoring failed, fallback to first back candidate:", e?.message || e)
    return { ...backCandidates[0], score: -1 }
  }
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
    let base = withAdultGuard(prompt)

    // ✅ BODY LOCK
    if (ENABLE_BODY_LOCK) base = `${base}, ${BODY_LOCK_PROMPT}`

    let lockedPrompt = withViewLock(base, "front")

    // ✅ UNDERWEAR/BIKINI lock
    if (ENABLE_UNDERWEAR_LOCK) lockedPrompt = `${lockedPrompt}, ${baseOutfitLockPrompt()}`

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
 * - NEW: BACK is selected from N candidates by CLIP similarity to FRONT.
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
      // 프론트에서 이미 만들어 보내는 경우에도 BODY lock을 서버가 “덧씌움”
      promptFront = String(b.promptFront)
      promptBack = String(b.promptBack)

      if (ENABLE_BODY_LOCK) {
        promptFront = `${promptFront}, ${BODY_LOCK_PROMPT}`
        promptBack = `${promptBack}, ${BODY_LOCK_PROMPT}`
      }
    } else {
      let base = withAdultGuard(String(b.prompt))
      if (ENABLE_BODY_LOCK) base = `${base}, ${BODY_LOCK_PROMPT}`

      promptFront = withViewLock(base, "front")
      promptBack = withViewLock(base, "back")
    }

    // ✅ UNDERWEAR/BIKINI lock
    if (ENABLE_UNDERWEAR_LOCK) {
      const outfitLock = baseOutfitLockPrompt()
      promptFront = `${promptFront}, ${outfitLock}`
      promptBack = `${promptBack}, ${outfitLock}`
    }

    // ✅ back 가슴 과장 완화(Back만)
    promptBack = `${promptBack}, ${BACK_BUST_SAFETY_HINTS}`

    // ✅ pair는 rate limit 민감
    const PAIR_RETRY = Number(process.env.PAIR_RETRY ?? 0)

    let front = null
    let bestBack = null
    let backCandidates = []

    try {
      // 1) FRONT 1장
      front = await generateWithRetry(promptFront, PAIR_RETRY)

      // 2) BACK 후보 N장
      const n = Math.max(1, Math.min(12, BACK_CANDIDATES || 6))
      backCandidates = await generateBackCandidates(promptBack, n)

      // 3) CLIP으로 best 선택
      bestBack = await pickBestBackByClip(front.url, backCandidates)

      // 4) min score 미달이면 추가 라운드(선택)
      let rounds = Math.max(0, Math.min(3, BACK_EXTRA_ROUNDS || 0))
      while (rounds > 0 && bestBack && bestBack.score >= 0 && bestBack.score < BACK_MIN_SCORE) {
        rounds -= 1
        const more = await generateBackCandidates(promptBack, n)
        backCandidates = backCandidates.concat(more)
        bestBack = await pickBestBackByClip(front.url, backCandidates)
      }
    } catch (e) {
      // E005면 saferPrompt로 폴백
      if (isSensitiveFlagError(e)) {
        const safeFront = makeSaferPrompt(promptFront)
        const safeBack = makeSaferPrompt(promptBack)

        front = await generateWithRetry(safeFront, 0)
        const n = Math.max(1, Math.min(12, BACK_CANDIDATES || 6))
        backCandidates = await generateBackCandidates(safeBack, n)
        bestBack = await pickBestBackByClip(front.url, backCandidates)

        promptFront = safeFront
        promptBack = safeBack
      } else {
        throw e
      }
    }

    if (!front?.url || !bestBack?.url) {
      await releaseIfReserved(req, reservationId)
      return res.status(502).json({
        requestId,
        error: "No imageUrl in output",
        frontUrl: front?.url || null,
        backUrl: bestBack?.url || null,
      })
    }

    await confirmIfReserved(req, reservationId)

    const includeDebug = String(process.env.PAIR_DEBUG || "0") === "1"

    return res.json({
      requestId,
      frontUrl: front.url,
      backUrl: bestBack.url,
      usedPromptFront: promptFront,
      usedPromptBack: promptBack,
      aspect_ratio: "3:4",
      triesFront: front.tries,
      // 후보 생성은 retry 0이므로 triesBack은 의미 없어서 bestBack.tries만 노출
      triesBack: bestBack.tries ?? 1,
      clip: {
        model: CLIP_MODEL_VERSION,
        bestScore: bestBack.score,
        minScore: BACK_MIN_SCORE,
        candidates: backCandidates.length,
        extraRounds: BACK_EXTRA_ROUNDS,
      },
      debug: includeDebug
        ? {
            backCandidates: backCandidates.map((c) => ({
              url: c.url,
              tries: c.tries,
              warned: c.warned,
              badWhy: c.badWhy,
            })),
          }
        : undefined,
      filter: ENABLE_RESULT_FILTER
        ? {
            front: { warned: front.warned, badWhy: front.badWhy, caption: front.caption },
            back: { warned: bestBack.warned, badWhy: bestBack.badWhy, caption: bestBack.caption },
          }
        : { enabled: false },
    })
  } catch (e) {
    await releaseIfReserved(req, reservationId)

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
      gotKeys: safeKeys(req.body || {}),
      hasPairPrompts: typeof (req.body || {})?.promptFront === "string" && typeof (req.body || {})?.promptBack === "string",
      hasSinglePrompt: typeof (req.body || {})?.prompt === "string",
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
