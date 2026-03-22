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
// server.js
// DRESSD S3 - Try-On Max Orchestrator
// Node 18+
// ENV:
//   FASHN_API_KEY=your_key
//   PORT=3000
//
// POST /api/dress-max
// body example:
// {
//   "model_front": "<url or dataUrl>",
//   "model_back": "<url or dataUrl>",
//   "top_front": "<url or dataUrl>",
//   "top_back": "<url or dataUrl>",
//   "bottom_front": "<url or dataUrl>",
//   "bottom_back": "<url or dataUrl>",
//   "outer_front": "<url or dataUrl>",
//   "outer_back": "<url or dataUrl>",
//   "dress_front": "<url or dataUrl>",
//   "dress_back": "<url or dataUrl>",
//   "debug": true,
//   "seed": 42,
//   "prompt_mode": "empty" // "empty" | "short"
// }

import express from "express"
import cors from "cors"
import sharp from "sharp"

const app = express()

const nodeMajor = Number(String(process.versions.node || "0").split(".")[0] || 0)
if (nodeMajor < 18) {
  console.error(`[BOOT] Node ${process.versions.node} detected. Node 18+ is required.`)
  process.exit(1)
}

const PORT = Number(process.env.PORT || 3000)
const FASHN_API_KEY = process.env.FASHN_API_KEY || ""

if (!FASHN_API_KEY) {
  console.warn("[BOOT] Missing FASHN_API_KEY")
}

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
    res.header("Access-Control-Allow-Origin", origin)
    res.header("Vary", "Origin")
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.header(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ||
      "Content-Type, Authorization, X-Requested-With"
  )
  res.header("Access-Control-Allow-Credentials", "true")

  if (req.method === "OPTIONS") return res.sendStatus(204)
  next()
})

app.use(cors())
app.use(express.json({ limit: "50mb" }))

const FASHN_RUN_URL = "https://api.fashn.ai/v1/run"
const FASHN_STATUS_URL = (id) => `https://api.fashn.ai/v1/status/${id}`

const SLOT_ORDER = ["bottom", "top", "outer"]
const VIEWS = ["front", "back"]

const DEFAULT_LONG_EDGE = 1600
const DEFAULT_JPEG_QUALITY = 92
const DEFAULT_POLL_INTERVAL_MS = 2500
const DEFAULT_POLL_TIMEOUT_MS = 1000 * 60 * 6
const DEFAULT_RETRY_COUNT = 1

function isHttpUrl(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v)
}

function isDataUrl(v) {
  return typeof v === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(v)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nowIso() {
  return new Date().toISOString()
}

function pick(obj, keys) {
  const out = {}
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k]
  }
  return out
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function safeErrMessage(err) {
  if (!err) return "Unknown error"
  if (typeof err === "string") return err
  if (err.message) return err.message
  try {
    return JSON.stringify(err)
  } catch {
    return "Unknown error"
  }
}

function toDataUrl(buffer, mime = "image/jpeg") {
  return `data:${mime};base64,${buffer.toString("base64")}`
}

function normalizePromptMode(v) {
  return v === "short" ? "short" : "empty"
}

function shortPromptForSlot(slot) {
  if (slot === "bottom") return "put on the pants"
  if (slot === "top") return "put on the top"
  if (slot === "outer") return "put on the outerwear"
  if (slot === "dress") return "put on the dress"
  return ""
}

function buildPlanForView(garmentsByView, view) {
  const hasDress = !!garmentsByView[view]?.dress
  if (hasDress) return ["dress"]
  return SLOT_ORDER.filter((slot) => !!garmentsByView[view]?.[slot])
}

function getRequestDebugMeta(body) {
  return {
    receivedAt: nowIso(),
    hasModelFront: !!body.model_front,
    hasModelBack: !!body.model_back,
    hasTopFront: !!body.top_front,
    hasTopBack: !!body.top_back,
    hasBottomFront: !!body.bottom_front,
    hasBottomBack: !!body.bottom_back,
    hasOuterFront: !!body.outer_front,
    hasOuterBack: !!body.outer_back,
    hasDressFront: !!body.dress_front,
    hasDressBack: !!body.dress_back,
    debug: !!body.debug,
    seed: typeof body.seed === "number" ? body.seed : null,
    prompt_mode: normalizePromptMode(body.prompt_mode),
  }
}

function normalizeInputs(body) {
  const models = {
    front: body.model_front || "",
    back: body.model_back || "",
  }

  const garmentsByView = {
    front: {
      top: body.top_front || "",
      bottom: body.bottom_front || "",
      outer: body.outer_front || "",
      dress: body.dress_front || "",
    },
    back: {
      top: body.top_back || "",
      bottom: body.bottom_back || "",
      outer: body.outer_back || "",
      dress: body.dress_back || "",
    },
  }

  return {
    models,
    garmentsByView,
    debug: !!body.debug,
    seed: Number.isFinite(body.seed) ? Math.floor(body.seed) : 42,
    promptMode: normalizePromptMode(body.prompt_mode),
  }
}

function validateInputs(norm) {
  const errors = []

  if (!norm.models.front && !norm.models.back) {
    errors.push("At least one model image is required: model_front or model_back")
  }

  for (const view of VIEWS) {
    const m = norm.models[view]
    if (m && !isHttpUrl(m) && !isDataUrl(m)) {
      errors.push(`model_${view} must be a public URL or data URL`)
    }

    for (const slot of ["top", "bottom", "outer", "dress"]) {
      const g = norm.garmentsByView[view][slot]
      if (g && !isHttpUrl(g) && !isDataUrl(g)) {
        errors.push(`${slot}_${view} must be a public URL or data URL`)
      }
    }
  }

  return errors
}

async function normalizeImageInput(input, options = {}) {
  const longEdge = clamp(Number(options.longEdge || DEFAULT_LONG_EDGE), 512, 4096)
  const quality = clamp(Number(options.quality || DEFAULT_JPEG_QUALITY), 60, 95)

  if (!input) return ""

  if (isHttpUrl(input)) return input

  if (!isDataUrl(input)) {
    throw new Error("Unsupported image input. Only public URL or data URL is allowed.")
  }

  const base64 = input.split(",")[1] || ""
  const src = Buffer.from(base64, "base64")

  const image = sharp(src, { failOn: "none" })
  const meta = await image.metadata()

  let width = meta.width || null
  let height = meta.height || null

  if (!width || !height) {
    const out = await image.jpeg({ quality, mozjpeg: true }).toBuffer()
    return toDataUrl(out, "image/jpeg")
  }

  const currentLong = Math.max(width, height)
  let targetWidth = width
  let targetHeight = height

  if (currentLong > longEdge) {
    const ratio = longEdge / currentLong
    targetWidth = Math.max(1, Math.round(width * ratio))
    targetHeight = Math.max(1, Math.round(height * ratio))
  }

  const out = await image
    .rotate()
    .resize(targetWidth, targetHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer()

  return toDataUrl(out, "image/jpeg")
}

async function preprocessAll(norm) {
  const prepared = {
    models: { front: "", back: "" },
    garmentsByView: {
      front: { top: "", bottom: "", outer: "", dress: "" },
      back: { top: "", bottom: "", outer: "", dress: "" },
    },
  }

  for (const view of VIEWS) {
    prepared.models[view] = await normalizeImageInput(norm.models[view], {
      longEdge: 1600,
      quality: 92,
    })

    for (const slot of ["top", "bottom", "outer", "dress"]) {
      prepared.garmentsByView[view][slot] = await normalizeImageInput(
        norm.garmentsByView[view][slot],
        {
          longEdge: 1600,
          quality: 92,
        }
      )
    }
  }

  return prepared
}

async function fashnRunTryOnMax({
  modelImage,
  productImage,
  prompt = "",
  seed = 42,
  numImages = 1,
  outputFormat = "png",
  returnBase64 = false,
}) {
  const payload = {
    model_name: "tryon-max",
    inputs: {
      model_image: modelImage,
      product_image: productImage,
      prompt,
      seed,
      num_images: numImages,
      output_format: outputFormat,
      return_base64: returnBase64,
    },
  }

  const res = await fetch(FASHN_RUN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FASHN_API_KEY}`,
    },
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      json?.error ||
      `FASHN run failed with ${res.status}`
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg))
  }

  const predictionId =
    json?.id ||
    json?.prediction_id ||
    json?.data?.id ||
    json?.result?.id ||
    ""

  if (!predictionId) {
    throw new Error("FASHN response did not include prediction id")
  }

  return {
    id: predictionId,
    raw: json,
    payload,
  }
}

async function fashnPollPrediction(id, opts = {}) {
  const intervalMs = Number(opts.intervalMs || DEFAULT_POLL_INTERVAL_MS)
  const timeoutMs = Number(opts.timeoutMs || DEFAULT_POLL_TIMEOUT_MS)
  const started = Date.now()

  for (;;) {
    const res = await fetch(FASHN_STATUS_URL(id), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${FASHN_API_KEY}`,
      },
    })

    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }

    if (!res.ok) {
      const msg =
        json?.error?.message ||
        json?.message ||
        json?.error ||
        `FASHN status failed with ${res.status}`
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg))
    }

    const status =
      json?.status ||
      json?.data?.status ||
      json?.result?.status ||
      "unknown"

    if (status === "completed" || status === "succeeded" || status === "success") {
      const outputs =
        json?.output ||
        json?.outputs ||
        json?.result?.output ||
        json?.data?.output ||
        null

      const finalImage =
        outputs?.images?.[0] ||
        outputs?.image ||
        outputs?.url ||
        json?.output_image ||
        json?.image ||
        json?.result?.image ||
        json?.result?.url ||
        null

      return { status, raw: json, finalImage: finalImage || null }
    }

    if (status === "failed" || status === "error" || status === "cancelled") {
      const msg =
        json?.error?.message ||
        json?.message ||
        json?.error ||
        `Prediction ${id} failed`
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg))
    }

    if (Date.now() - started > timeoutMs) {
      throw new Error(`Prediction ${id} timed out`)
    }

    await sleep(intervalMs)
  }
}

async function runTryOnStep({
  slot,
  inputModel,
  garment,
  seed,
  promptMode,
  debug = false,
}) {
  const prompt = promptMode === "short" ? shortPromptForSlot(slot) : ""

  const run = await fashnRunTryOnMax({
    modelImage: inputModel,
    productImage: garment,
    prompt,
    seed,
    numImages: 1,
    outputFormat: "png",
    returnBase64: false,
  })

  const done = await fashnPollPrediction(run.id)

  return {
    slot,
    prompt,
    predictionId: run.id,
    inputModel,
    garment,
    output: done.finalImage,
    debugRunRaw: debug ? run.raw : undefined,
    debugStatusRaw: debug ? done.raw : undefined,
  }
}

async function runTryOnStepWithRetry(args, retryCount = DEFAULT_RETRY_COUNT) {
  let lastErr = null

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const seed = (args.seed || 42) + attempt

    try {
      const out = await runTryOnStep({
        ...args,
        seed,
      })
      return {
        ok: true,
        step: out,
        attempts: attempt + 1,
      }
    } catch (err) {
      lastErr = err
      if (attempt >= retryCount) break
    }
  }

  return {
    ok: false,
    error: safeErrMessage(lastErr),
    attempts: retryCount + 1,
  }
}

async function runSequentialView({
  view,
  modelImage,
  garments,
  seed,
  promptMode,
  debug,
}) {
  const plan = buildPlanForView({ [view]: garments }, view)

  if (!modelImage) {
    return {
      ok: false,
      view,
      error: `model_${view} is missing`,
      plan,
      finalUrl: "",
      steps: [],
    }
  }

  if (plan.length === 0) {
    return {
      ok: true,
      view,
      plan,
      finalUrl: modelImage,
      steps: [],
      warning: `No garments uploaded for ${view}`,
    }
  }

  let currentModel = modelImage
  const steps = []

  for (let i = 0; i < plan.length; i++) {
    const slot = plan[i]
    const garment = garments[slot]

    if (!garment) continue

    const result = await runTryOnStepWithRetry(
      {
        slot,
        inputModel: currentModel,
        garment,
        seed: seed + i,
        promptMode,
        debug,
      },
      DEFAULT_RETRY_COUNT
    )

    if (!result.ok) {
      return {
        ok: false,
        view,
        plan,
        finalUrl: currentModel,
        steps,
        failedStep: slot,
        error: result.error || `Failed on ${slot}`,
      }
    }

    steps.push({
      slot,
      attempts: result.attempts,
      inputModel: result.step.inputModel,
      garment: result.step.garment,
      output: result.step.output,
      prompt: result.step.prompt,
      predictionId: result.step.predictionId,
      ...(debug
        ? {
            debugRunRaw: result.step.debugRunRaw,
            debugStatusRaw: result.step.debugStatusRaw,
          }
        : {}),
    })

    currentModel = result.step.output || currentModel
  }

  return {
    ok: true,
    view,
    plan,
    finalUrl: currentModel,
    steps,
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "dressd-s3-tryon-max",
    time: nowIso(),
    hasApiKey: !!FASHN_API_KEY,
  })
})

app.post("/api/dress-max", async (req, res) => {
  const startedAt = Date.now()
  const requestMeta = getRequestDebugMeta(req.body)

  try {
    if (!FASHN_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Server is missing FASHN_API_KEY",
      })
    }

    const norm = normalizeInputs(req.body)
    const errors = validateInputs(norm)

    if (errors.length) {
      return res.status(400).json({
        ok: false,
        error: "Invalid request",
        details: errors,
      })
    }

    const prepared = await preprocessAll(norm)

    const frontPromise = runSequentialView({
      view: "front",
      modelImage: prepared.models.front,
      garments: prepared.garmentsByView.front,
      seed: norm.seed,
      promptMode: norm.promptMode,
      debug: norm.debug,
    })

    const backPromise = runSequentialView({
      view: "back",
      modelImage: prepared.models.back,
      garments: prepared.garmentsByView.back,
      seed: norm.seed + 1000,
      promptMode: norm.promptMode,
      debug: norm.debug,
    })

    const [front, back] = await Promise.all([frontPromise, backPromise])

    return res.json({
      ok: !!front.ok || !!back.ok,
      mode: "tryon-max",
      front,
      back,
      meta: {
        request: requestMeta,
        elapsedMs: Date.now() - startedAt,
        prepared: norm.debug
          ? {
              models: {
                front: prepared.models.front ? "prepared" : "",
                back: prepared.models.back ? "prepared" : "",
              },
              garments: {
                front: pick(prepared.garmentsByView.front, ["top", "bottom", "outer", "dress"]),
                back: pick(prepared.garmentsByView.back, ["top", "bottom", "outer", "dress"]),
              },
            }
          : undefined,
      },
    })
  } catch (err) {
    console.error("[/api/dress-max] ERROR:", err)
    return res.status(500).json({
      ok: false,
      error: safeErrMessage(err),
      meta: {
        request: requestMeta,
        elapsedMs: Date.now() - startedAt,
      },
    })
  }
})

app.listen(PORT, () => {
  console.log(`[BOOT] DRESSD S3 Try-On Max listening on :${PORT}`)
})
