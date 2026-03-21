// server.js
// ✅ S1: front + pair(front/back) 유지
// ✅ S3: FASHN /api/dress 확장 (3-layer steps[] + distortion lock + debug 강화)
// ✅ Node 18+
// ✅ CORS + preflight + credits + idempotent reserve/release 유지

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

  const reqHeaders = req.headers["access-control-request-headers"]
  res.setHeader(
    "Access-Control-Allow-Headers",
    reqHeaders || "Content-Type, Authorization, X-Client-Id, x-client-id"
  )

  if (req.method === "OPTIONS") return res.status(204).end()
  next()
})

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
 * ✅ 2) Body parser
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
    version: "2026-03-15_s1pair_s3dress_3layer_steps_distortionlock_debug_v2",
    node: process.versions.node,
    config: {
      ENABLE_BODY_LOCK: process.env.ENABLE_BODY_LOCK !== "0",
      ENABLE_UNDERWEAR_LOCK: process.env.ENABLE_UNDERWEAR_LOCK !== "0",
      ENABLE_RESULT_FILTER: process.env.ENABLE_RESULT_FILTER !== "0",

      BACK_CANDIDATES: Number(process.env.BACK_CANDIDATES || 8),
      BACK_CONCURRENCY: Number(process.env.BACK_CONCURRENCY || 3),
      BACK_MIN_SCORE: Number(process.env.BACK_MIN_SCORE || 0),
      BACK_EXTRA_ROUNDS: Number(process.env.BACK_EXTRA_ROUNDS || 1),

      CLIP_MODEL_VERSION: process.env.CLIP_MODEL_VERSION || "openai/clip",
      CAPTION_MODEL_VERSION:
        process.env.CAPTION_MODEL_VERSION ||
        "salesforce/blip:2e1dddc8621f72155f24cf2e0adbde548458d3cab9f00c0139c1a7fe2a1b3b3f",

      UNDERWEAR_STYLE: String(process.env.UNDERWEAR_STYLE || "underwear"),
      UNDERWEAR_COLOR: String(process.env.UNDERWEAR_COLOR || "pure white"),

      PAIR_DEBUG: process.env.PAIR_DEBUG || "0",

      // S3
      FASHN_MODEL_NAME: process.env.FASHN_MODEL_NAME || "tryon-v1.6",
      HAS_FASHN_KEY: !!process.env.FASHN_API_KEY,
      HAS_REPLICATE_KEY: !!process.env.REPLICATE_API_TOKEN,
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

  if (r.status === "confirmed") {
    const w = ensureWallet(cid)
    return res.json({
      ok: true,
      reservationId,
      status: "confirmed",
      balance: w.balance,
      reserved: w.reserved,
      available: w.balance - w.reserved,
    })
  }

  if (r.status !== "reserved") {
    const w = ensureWallet(cid)
    return res.json({
      ok: true,
      reservationId,
      status: r.status,
      balance: w.balance,
      reserved: w.reserved,
      available: w.balance - w.reserved,
    })
  }

  const w = ensureWallet(cid)
  w.reserved = Math.max(0, w.reserved - r.amount)
  w.balance = Math.max(0, w.balance - r.amount)

  r.status = "confirmed"
  reservations.set(reservationId, r)

  return res.json({
    ok: true,
    reservationId,
    status: "confirmed",
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

  if (!r) {
    const w = ensureWallet(cid)
    return res.json({
      ok: true,
      reservationId,
      status: "not_found",
      balance: w.balance,
      reserved: w.reserved,
      available: w.balance - w.reserved,
    })
  }

  if (r.clientId !== cid) {
    return res.status(403).json({ error: "Forbidden" })
  }

  if (r.status !== "reserved") {
    const w = ensureWallet(cid)
    return res.json({
      ok: true,
      reservationId,
      status: r.status,
      balance: w.balance,
      reserved: w.reserved,
      available: w.balance - w.reserved,
    })
  }

  const w = ensureWallet(cid)
  w.reserved = Math.max(0, w.reserved - r.amount)

  r.status = "released"
  reservations.set(reservationId, r)

  return res.json({
    ok: true,
    reservationId,
    status: "released",
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
 * ✅ 5) Replicate / Imagen + Filter + 429/E005 helpers
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

function safeSlice(v, n = 300) {
  return String(v || "").replace(/\s+/g, " ").slice(0, n)
}

function withAdultGuard(prompt) {
  return `adult, age 25, ${prompt}`
}

function hairHintsFront() {
  return ["hair centered", "symmetrical hairstyle", "no wind", "no dramatic motion"].join(", ")
}
function hairHintsBack() {
  return ["no wind", "no dramatic motion", "natural hair fall"].join(", ")
}

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
 * ✅ 5-A) BODY LOCK
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
 * ✅ 5-B) UNDERWEAR / BIKINI SHAPE LOCK (Adult)
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

const BACK_BUST_SAFETY_HINTS = [
  "natural back silhouette",
  "no exaggerated chest protrusion",
  "no unnatural side bulge",
  "realistic anatomy",
].join(", ")

const ENABLE_RESULT_FILTER = process.env.ENABLE_RESULT_FILTER !== "0"

const CAPTION_MODEL_VERSION =
  process.env.CAPTION_MODEL_VERSION ||
  "salesforce/blip:2e1dddc8621f72155f24cf2e0adbde548458d3cab9f00c0139c1a7fe2a1b3b3f"

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

function isSensitiveFlagError(err) {
  const msg = String(err?.message || "")
  return msg.includes("(E005)") || msg.toLowerCase().includes("flagged as sensitive")
}

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

function isNotBackByCaption(caption) {
  const c = String(caption || "").toLowerCase()
  if (!c) return false

  const bad = [
    "front view",
    "front-facing",
    "facing camera",
    "side view",
    "profile",
    "three-quarter",
    "three quarter",
    "3/4",
    "quarter view",
    "over the shoulder",
    "looking back",
  ]
  const good = ["back view", "rear view", "from behind", "back of", "facing away", "rear"]

  const hasGood = good.some((t) => c.includes(t))
  const hasBad = bad.some((t) => c.includes(t))

  if (hasBad && !hasGood) return true
  return false
}

/**
 * ============================================================
 * ✅ 5-5) CLIP scoring for FRONT vs BACK candidates
 * ============================================================
 */
const BACK_CANDIDATES = Number(process.env.BACK_CANDIDATES || 8)
const BACK_CONCURRENCY = Number(process.env.BACK_CONCURRENCY || 3)
const BACK_MIN_SCORE = Number(process.env.BACK_MIN_SCORE || 0)
const BACK_EXTRA_ROUNDS = Number(process.env.BACK_EXTRA_ROUNDS || 1)
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

async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length)
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const cur = idx++
      try {
        results[cur] = await tasks[cur]()
      } catch (e) {
        results[cur] = { __error: true, error: e }
      }
    }
  }

  const c = Math.max(1, Math.min(8, Number(concurrency || 3)))
  const workers = Array.from({ length: c }, () => worker())
  await Promise.all(workers)
  return results
}

async function generateBackCandidates(promptBack, n) {
  const want = Math.max(1, Math.min(12, Number(n || 8)))
  const rounds = Math.max(0, Math.min(3, Number(BACK_EXTRA_ROUNDS || 0)))

  let collected = []

  for (let round = 0; round <= rounds; round++) {
    const tasks = Array.from({ length: want }, () => async () => {
      const r = await generateWithRetry(promptBack, 0)
      if (!r?.url) return null

      const cap = await captionImageBestEffort(r.url)
      const caption = cap.caption || ""

      if (isNotBackByCaption(caption)) return null

      return { ...r, caption }
    })

    const out = await runPool(tasks, BACK_CONCURRENCY)

    const ok = out.map((x) => (x && x.__error ? null : x)).filter(Boolean)

    collected = collected.concat(ok)

    if (collected.length >= Math.max(2, Math.floor(want / 2))) break
  }

  if (!collected.length) throw new Error("No usable back candidates")

  return collected
}

async function pickBestBackByClip(frontUrl, backCandidates) {
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

// /api/s1 (FRONT 1장)
app.post("/api/s1", async (req, res) => {
  const requestId = rid()
  const { prompt, reservationId } = req.body || {}

  if (!mustHaveToken(res)) return
  if (!prompt) return res.status(400).json({ requestId, error: "Prompt missing" })

  try {
    let base = withAdultGuard(String(prompt))

    if (ENABLE_BODY_LOCK) base = `${base}, ${BODY_LOCK_PROMPT}`

    let lockedPrompt = withViewLock(base, "front")

    if (ENABLE_UNDERWEAR_LOCK) lockedPrompt = `${lockedPrompt}, ${baseOutfitLockPrompt()}`

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
 * /api/s1/pair (FRONT+BACK 2장)
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

    if (ENABLE_UNDERWEAR_LOCK) {
      const outfitLock = baseOutfitLockPrompt()
      promptFront = `${promptFront}, ${outfitLock}`
      promptBack = `${promptBack}, ${outfitLock}`
    }

    promptBack = [
      "STRICT FULL BACK VIEW ONLY",
      "REAR VIEW ONLY",
      "SUBJECT FACING AWAY FROM CAMERA",
      "CAMERA DIRECTLY BEHIND SUBJECT",
      "NO THREE-QUARTER ANGLE",
      "NO SIDE VIEW",
      promptBack,
      BACK_BUST_SAFETY_HINTS,
    ].join(", ")

    const PAIR_RETRY = Number(process.env.PAIR_RETRY ?? 0)

    let front = null
    let bestBack = null
    let backCandidates = []

    try {
      front = await generateWithRetry(promptFront, PAIR_RETRY)

      const n = Math.max(1, Math.min(12, BACK_CANDIDATES || 8))
      backCandidates = await generateBackCandidates(promptBack, n)

      bestBack = await pickBestBackByClip(front.url, backCandidates)
    } catch (e) {
      if (isSensitiveFlagError(e)) {
        const safeFront = makeSaferPrompt(promptFront)
        const safeBack = makeSaferPrompt(promptBack)

        front = await generateWithRetry(safeFront, 0)

        const n = Math.max(1, Math.min(12, BACK_CANDIDATES || 8))
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
        error: "No frontUrl/backUrl in output",
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
      triesBack: bestBack.tries ?? 1,
      clip: {
        model: CLIP_MODEL_VERSION,
        bestScore: bestBack.score,
        minScore: BACK_MIN_SCORE,
        candidatesUsed: backCandidates.length,
        candidatesRequested: Math.max(1, Math.min(12, BACK_CANDIDATES || 8)),
        concurrency: BACK_CONCURRENCY,
        extraRounds: BACK_EXTRA_ROUNDS,
      },
      debug: includeDebug
        ? {
            backCandidates: backCandidates.slice(0, 12).map((c) => ({
              url: c.url,
              tries: c.tries,
              warned: c.warned,
              badWhy: c.badWhy,
              caption: c.caption || "",
              score: c.score ?? null,
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
      hasPairPrompts:
        typeof (req.body || {})?.promptFront === "string" &&
        typeof (req.body || {})?.promptBack === "string",
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
 * ✅ 7) S3 Dress (FASHN) - preserve only
 * ============================================================
 */
const FASHN_BASE = "https://api.fashn.ai/v1"
const FASHN_MODEL_NAME = process.env.FASHN_MODEL_NAME || "tryon-v1.6"

/** ---------- shared helpers ---------- */
function isDataUrl(v) {
  return typeof v === "string" && v.startsWith("data:image/")
}

function exists(v) {
  return typeof v === "string" && v.startsWith("data:image/")
}

function normalizeView(view) {
  return String(view || "").toLowerCase() === "back" ? "back" : "front"
}

function titleJoin(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return "None"
  return parts.join(" + ")
}

const GARMENT_ORDER = ["bottom", "top", "dress", "outer"]
const GARMENT_LABEL = {
  top: "Top",
  bottom: "Bottom",
  outer: "Outer",
  dress: "Dress",
}

function sortGarments(types) {
  const set = new Set(Array.isArray(types) ? types : [])
  return GARMENT_ORDER.filter((k) => set.has(k))
}

function compact(arr) {
  return (arr || []).filter(Boolean)
}

function garmentTypesToText(types) {
  return titleJoin((types || []).map((t) => GARMENT_LABEL[t] || t))
}

function getGarmentUrl(view, garments, name) {
  const key = `${name}_${view}`
  return garments?.[key] || ""
}

function getUploadedPresenceForView(garments, view) {
  const dressUrl =
    getGarmentUrl(view, garments, "dress") ||
    getGarmentUrl(view, garments, "onepiece")

  return {
    top: exists(getGarmentUrl(view, garments, "top")),
    bottom: exists(getGarmentUrl(view, garments, "bottom")),
    outer: exists(getGarmentUrl(view, garments, "outer")),
    dress: exists(dressUrl),
  }
}

/** ---------- conflict / steps ---------- */
function resolvePresenceConflicts(presence) {
  const resolved = { ...presence }
  const ignoredParts = []

  if (resolved.dress) {
    if (resolved.top) {
      resolved.top = false
      ignoredParts.push("top")
    }
    if (resolved.bottom) {
      resolved.bottom = false
      ignoredParts.push("bottom")
    }
  }

  return {
    resolved,
    ignoredParts: sortGarments(ignoredParts),
  }
}

function buildLayerStepsFromResolvedPresence(presence) {
  const steps = []

  if (presence.dress) {
    steps.push("dress")
  } else {
    if (presence.bottom) steps.push("bottom")
    if (presence.top) steps.push("top")
  }

  if (presence.outer) steps.push("outer")

  return steps
}

function buildPlanSummary(plan) {
  const uploadedText = garmentTypesToText(plan.uploaded)
  const resolvedText = garmentTypesToText(plan.uploadedResolved)
  const ignoredText = garmentTypesToText(plan.ignoredParts)
  const stepsText = garmentTypesToText(plan.steps)

  return {
    uploadedText,
    resolvedText,
    ignoredText,
    stepsText,
    shortLine: [
      `Uploaded: ${uploadedText}`,
      `Resolved: ${resolvedText}`,
      `Ignored: ${ignoredText}`,
      `Steps: ${stepsText}`,
    ].join(" / "),
  }
}

function buildOutfitPlanFromGarments({ garments, view }) {
  const normalizedView = normalizeView(view)
  const uploadedPresence = getUploadedPresenceForView(garments, normalizedView)

  const uploaded = sortGarments(
    compact([
      uploadedPresence.bottom ? "bottom" : null,
      uploadedPresence.top ? "top" : null,
      uploadedPresence.dress ? "dress" : null,
      uploadedPresence.outer ? "outer" : null,
    ])
  )

  const { resolved, ignoredParts } = resolvePresenceConflicts(uploadedPresence)

  const uploadedResolved = sortGarments(
    compact([
      resolved.bottom ? "bottom" : null,
      resolved.top ? "top" : null,
      resolved.dress ? "dress" : null,
      resolved.outer ? "outer" : null,
    ])
  )

  const steps = buildLayerStepsFromResolvedPresence(resolved)

  const plan = {
    view: normalizedView,
    uploaded,
    uploadedResolved,
    ignoredParts,
    steps,
  }

  return {
    ...plan,
    summary: buildPlanSummary(plan),
  }
}

function pickEffectiveGarmentUrls({ garments, view, plan }) {
  const out = {}
  const normalizedView = normalizeView(view)

  for (const type of plan.steps || []) {
    const key = `${type}_${normalizedView}`

    if (type === "dress") {
      const url =
        garments?.[`dress_${normalizedView}`] ||
        garments?.[`onepiece_${normalizedView}`]
      if (exists(url)) out[key] = url
      continue
    }

    const url = garments?.[key]
    if (exists(url)) out[key] = url
  }

  return out
}

function summarizeEffectiveGarments(effectiveGarments) {
  const keys = Object.keys(effectiveGarments || {})
  return {
    count: keys.length,
    keys,
    preview: keys.reduce((acc, k) => {
      const v = effectiveGarments[k]
      acc[k] = isDataUrl(v) ? `dataUrl(${String(v).length})` : safeSlice(v, 120)
      return acc
    }, {}),
  }
}

/** ---------- prompt ---------- */
function sanitizeDressPrompt(prompt) {
  return String(prompt || "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/^,\s*|\s*,$/g, "")
    .trim()
    .slice(0, 2000)
}

function makeStepPrompt({ basePrompt, stepType, stepIndex, totalSteps }) {
  const stepHints = []

  if (stepType === "top") stepHints.push("upper-body garment fitting")
  if (stepType === "bottom") stepHints.push("lower-body garment fitting")
  if (stepType === "dress") stepHints.push("one-piece garment fitting")
  if (stepType === "outer") stepHints.push("outer layer fitting")

  stepHints.push(`step ${stepIndex + 1} of ${totalSteps}`)

  return sanitizeDressPrompt(
    [basePrompt, stepHints.join(", ")].filter(Boolean).join(", ")
  )
}

/** ---------- FASHN ---------- */
function fashnHeaders() {
  const key = process.env.FASHN_API_KEY
  if (!key) throw new Error("FASHN_API_KEY missing on server")
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  }
}

function pickOutputImageUrl(output) {
  return Array.isArray(output)
    ? output[0]
    : typeof output === "string"
      ? output
      : output?.image || output?.image_url || output?.url
}

async function runFashnTryOn({
  requestId,
  stepIndex,
  stepType,
  modelImage,
  productImage,
}) {
  const body = {
    model_image: modelImage,
    garment_image: productImage,
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
    console.error(`[${requestId}] FASHN /run failed`, {
      stepIndex,
      stepType,
      status: r.status,
      statusText: r.statusText,
      responsePreview: text,
      requestBodyPreview: body,
    })

    throw new Error(
      json?.error ||
        text ||
        `FASHN /run failed: step=${stepType} HTTP ${r.status}`
    )
  }

  const predictionId = json?.id
  if (!predictionId) {
    throw new Error("FASHN /run returned no id")
  }

  return {
    predictionId,
    status: json?.status || "starting",
  }
}

async function pollFashnPrediction(id, requestId, stepType) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1500))

    const rr = await fetch(`${FASHN_BASE}/status/${id}`, {
      headers: fashnHeaders(),
    })

    const text = await rr.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}

    if (!rr.ok) {
      console.error(`[${requestId}] FASHN /status failed`, {
        predictionId: id,
        stepType,
        status: rr.status,
        statusText: rr.statusText,
        responsePreview: safeSlice(text, 500),
      })

      throw new Error(
        json?.error || `FASHN /status failed: HTTP ${rr.status} ${text.slice(0, 500)}`
      )
    }

    const status = json?.status

    if (status === "completed") {
      const imageUrl = pickOutputImageUrl(json?.output)
      if (!imageUrl) {
        console.error(`[${requestId}] FASHN completed but no image`, {
          predictionId: id,
          stepType,
          raw: json,
        })
        throw new Error("No imageUrl in output")
      }
      return imageUrl
    }

    if (
      ["failed", "canceled", "cancelled"].includes(
        String(status || "").toLowerCase()
      )
    ) {
      console.error(`[${requestId}] FASHN prediction failed`, {
        predictionId: id,
        stepType,
        status,
        raw: json,
      })
      throw new Error(json?.error || `prediction ${status}`)
    }
  }

  throw new Error("timeout: prediction not finished")
}

// 안내용
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress or GET /api/dress/:id" })
})

// 1) 합성 시작
app.post("/api/dress", async (req, res) => {
  const requestId = rid()

  try {
    const b = req.body || {}
    const view = normalizeView(b.view || "front")
    const model = b.model
    const garments = b.garments || {}
    const clientPrompt = String(b.prompt || "")
    const clientNegativePrompt = String(b.negativePrompt || "")

    if (!isDataUrl(model)) {
      return res.status(400).json({
        requestId,
        error: "model must be a dataUrl (data:image/...)",
      })
    }

    const serverPlan = buildOutfitPlanFromGarments({
      garments,
      view,
    })

    const effectiveGarments = pickEffectiveGarmentUrls({
      garments,
      view,
      plan: serverPlan,
    })

    if (!Array.isArray(serverPlan.steps) || serverPlan.steps.length === 0) {
      return res.status(400).json({
        requestId,
        error: `No usable garment uploaded for ${view}`,
        plan: serverPlan,
      })
    }

    if (Object.keys(effectiveGarments).length === 0) {
      return res.status(400).json({
        requestId,
        error: `No effective garments found for ${view}`,
        plan: serverPlan,
      })
    }

    console.log(`[${requestId}] /api/dress start`, {
      view,
      modelLen: String(model || "").length,
      planSteps: serverPlan.steps,
      effectiveGarments: summarizeEffectiveGarments(effectiveGarments),
      planSummary: serverPlan.summary?.shortLine,
      promptLen: clientPrompt.length,
      negativeLen: clientNegativePrompt.length,
    })

    let currentModel = model
    const usedSteps = []
    const stepDebug = []

    for (let i = 0; i < serverPlan.steps.length; i++) {
      const stepType = serverPlan.steps[i]
      const stepKey = `${stepType}_${view}`
      const productImage = effectiveGarments[stepKey]

      if (!isDataUrl(productImage)) {
        return res.status(400).json({
          requestId,
          error: `${stepKey} missing or not dataUrl`,
          plan: serverPlan,
          debug: {
            failedStepIndex: i,
            failedStepType: stepType,
            failedStepKey: stepKey,
            usedSteps,
          },
        })
      }

      const stepPrompt = makeStepPrompt({
        basePrompt: clientPrompt,
        stepType,
        stepIndex: i,
        totalSteps: serverPlan.steps.length,
      })

      console.log(`[${requestId}] /api/dress step`, {
        stepIndex: i,
        stepType,
        stepKey,
        promptLen: stepPrompt.length,
        negativeLen: clientNegativePrompt.length,
      })

      try {
        const run = await runFashnTryOn({
          requestId,
          stepIndex: i,
          stepType,
          modelImage: currentModel,
          productImage,
         
      })

        const imageUrl = await pollFashnPrediction(
          run.predictionId,
          requestId,
          stepType
        )

        currentModel = imageUrl
        usedSteps.push(stepType)

        stepDebug.push({
          stepIndex: i,
          stepType,
          stepKey,
          predictionId: run.predictionId,
          outputImageUrl: imageUrl,
          promptPreview: String(stepPrompt || "").slice(0, 240),
          negativePreview: String(clientNegativePrompt || "").slice(0, 180),
        })
      } catch (stepErr) {
        const stepMessage = String(stepErr?.message ?? stepErr)

        console.error(`[${requestId}] /api/dress STEP ERROR`, {
          stepIndex: i,
          stepType,
          stepKey,
          message: stepMessage,
          promptPreview: String(stepPrompt || "").slice(0, 300),
        })

        return res.status(500).json({
          requestId,
          error: stepMessage,
          plan: {
            ...serverPlan,
            steps: usedSteps,
          },
          debug: {
            failedStepIndex: i,
            failedStepType: stepType,
            failedStepKey: stepKey,
            usedSteps,
            promptPreview: String(stepPrompt || "").slice(0, 300),
            stepDebug,
          },
        })
      }
    }

    return res.json({
      requestId,
      status: "succeeded",
      imageUrl: currentModel,
      steps: usedSteps,
      plan: {
        ...serverPlan,
        steps: usedSteps,
      },
      debug: {
        engine: {
          view,
          model: "dataUrl",
          modelLen: String(model || "").length,
          garments: Object.keys(effectiveGarments).length,
          steps: usedSteps.join(" -> "),
        },
        steps: stepDebug,
      },
    })
  } catch (e) {
    console.error(`[${requestId}] /api/dress ERROR`, {
      message: e?.message ?? String(e),
      stack: e?.stack,
      bodyKeys: safeKeys(req.body || {}),
    })

    return res.status(500).json({
      requestId,
      error: String(e?.message ?? e),
      debug: {
        bodyKeys: safeKeys(req.body || {}),
      },
    })
  }
})

// 2) 결과 폴링 (기존 Runner 호환용 유지)
app.get("/api/dress/:id", async (req, res) => {
  try {
    const id = req.params.id

    const r = await fetch(`${FASHN_BASE}/status/${id}`, {
      headers: fashnHeaders(),
    })

    const text = await r.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}

    if (!r.ok) {
      return res.status(r.status).json({
        error:
          json?.error ||
          `FASHN /status failed: HTTP ${r.status} ${text.slice(0, 500)}`,
      })
    }

    const status = json?.status

    if (status === "completed") {
      const imageUrl = pickOutputImageUrl(json?.output)

      if (!imageUrl) {
        return res.status(502).json({
          error: "No imageUrl in output",
          raw: json,
        })
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

/**
 * ============================================================
 * ✅ Start
 * ============================================================
 */
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
