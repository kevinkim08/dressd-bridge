// server.js
// ✅ S1: front + pair(front/back) 유지
// ✅ S3: FASHN /api/dress 확장 (3-layer steps[] + distortion lock + debug 강화)
// ✅ Node 18+
// ✅ CORS + preflight + credits + idempotent reserve/release 유지

import express from "express"
import cors from "cors"
import Replicate from "replicate"
import sharp from "sharp"
import NodeFormData from "form-data"

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
 * ✅ 7) S3 Dress (FASHN) - Try-On Max preserve only
 * ✅ INPUT: model dataURL -> Cloudflare URL / garment dataURL -> Cloudflare URL
 * ✅ OUTPUT: final result only -> Cloudflare Images upload
 * ✅ finalUrl always keeps FASHN original URL
 * ✅ Cloudflare is storage-only asset
 * ============================================================
 */

const FASHN_RUN_URL = "https://api.fashn.ai/v1/run"
const FASHN_STATUS_URL = (id) => `https://api.fashn.ai/v1/status/${id}`

const S3_SLOT_ORDER = ["bottom", "top", "outer"]
const S3_VIEWS = ["front", "back"]

const S3_DEFAULT_POLL_INTERVAL_MS = 2500
const S3_DEFAULT_POLL_TIMEOUT_MS = 1000 * 60 * 6
const S3_DEFAULT_RETRY_COUNT = 1

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || ""
const CF_IMAGES_TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN || ""

/* ============================================================
 * ✅ common helpers
 * ============================================================
 */

function s3IsHttpUrl(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v)
}

function s3IsDataUrl(v) {
  return typeof v === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(v)
}

function s3Sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function s3NowIso() {
  return new Date().toISOString()
}

function s3Pick(obj, keys) {
  const out = {}
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k]
  }
  return out
}

function s3Clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function s3ToNumber(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function s3SafeErrMessage(err) {
  if (!err) return "Unknown error"
  if (typeof err === "string") return err
  if (err.message) return err.message
  try {
    return JSON.stringify(err)
  } catch {
    return "Unknown error"
  }
}

function s3NormalizePromptMode(v) {
  return v === "short" ? "short" : "empty"
}

function s3ShortPromptForSlot(slot) {
  if (slot === "bottom") return "put on the pants"
  if (slot === "top") return "put on the top"
  if (slot === "outer") return "put on the outerwear"
  if (slot === "dress") return "put on the dress"
  return ""
}

function s3BuildPlanForView(garmentsByView, view) {
  const hasDress = !!garmentsByView[view]?.dress
  if (hasDress) return ["dress"]
  return S3_SLOT_ORDER.filter((slot) => !!garmentsByView[view]?.[slot])
}

/* ============================================================
 * ✅ meta / retry / score helpers
 * ============================================================
 */

function s3NormalizeLengthMeta(meta) {
  const src = meta && typeof meta === "object" ? meta : {}
  const next = {}

  if (src.top && typeof src.top === "object") {
    next.top = {}
    if (typeof src.top.sleeve === "string" && src.top.sleeve.trim()) {
      next.top.sleeve = src.top.sleeve.trim().toLowerCase()
    }
    if (typeof src.top.length === "string" && src.top.length.trim()) {
      next.top.length = src.top.length.trim().toLowerCase()
    }
  }

  if (src.bottom && typeof src.bottom === "object") {
    next.bottom = {}
    if (typeof src.bottom.length === "string" && src.bottom.length.trim()) {
      next.bottom.length = src.bottom.length.trim().toLowerCase()
    }
  }

  if (src.outer && typeof src.outer === "object") {
    next.outer = {}
    if (typeof src.outer.length === "string" && src.outer.length.trim()) {
      next.outer.length = src.outer.length.trim().toLowerCase()
    }
  }

  if (src.dress && typeof src.dress === "object") {
    next.dress = {}
    if (typeof src.dress.length === "string" && src.dress.length.trim()) {
      next.dress.length = src.dress.length.trim().toLowerCase()
    }
  }

  return next
}

function s3NormalizeRetryPolicy(input) {
  const src = input && typeof input === "object" ? input : {}
  const enabled = src.enabled !== false
  const maxAttempts = s3Clamp(s3ToNumber(src.max_attempts, 3), 1, 4)
  const passScore = s3Clamp(s3ToNumber(src.pass_score, 70), 40, 100)
  const warningScore = s3Clamp(s3ToNumber(src.warning_score, 55), 20, passScore)

  return {
    enabled,
    maxAttempts,
    passScore,
    warningScore,
  }
}

function s3GetGarmentKeysForView(garments, view) {
  const keys = []
  if (garments?.top) keys.push(`top_${view}`)
  if (garments?.bottom) keys.push(`bottom_${view}`)
  if (garments?.outer) keys.push(`outer_${view}`)
  if (garments?.dress) keys.push(`dress_${view}`)
  return keys
}

function s3ScoreMetaMatch({ meta, garments, view, resultUrl, attemptIndex = 1 }) {
  const normalizedMeta = s3NormalizeLengthMeta(meta)
  const garmentKeys = s3GetGarmentKeysForView(garments, view)

  let total = 60
  let lengthScore = 0
  let detailScore = 20
  let stabilityScore = 20
  const scoreParts = []
  const warnings = []

  const hasTop = garmentKeys.includes(`top_${view}`)
  const hasBottom = garmentKeys.includes(`bottom_${view}`)
  const hasOuter = garmentKeys.includes(`outer_${view}`)
  const hasDress = garmentKeys.includes(`dress_${view}`)

  if (normalizedMeta.top?.sleeve && hasTop) {
    lengthScore += 5
    scoreParts.push({
      code: "TOP_SLEEVE_META_PRESENT",
      score: 5,
      note: `top sleeve hint: ${normalizedMeta.top.sleeve}`,
    })
  }

  if (normalizedMeta.top?.length && hasTop) {
    lengthScore += 8
    scoreParts.push({
      code: "TOP_LENGTH_META_PRESENT",
      score: 8,
      note: `top length hint: ${normalizedMeta.top.length}`,
    })
  }

  if (normalizedMeta.bottom?.length && hasBottom) {
    lengthScore += 12
    scoreParts.push({
      code: "BOTTOM_LENGTH_META_PRESENT",
      score: 12,
      note: `bottom length hint: ${normalizedMeta.bottom.length}`,
    })
  }

  if (normalizedMeta.outer?.length && hasOuter) {
    lengthScore += 10
    scoreParts.push({
      code: "OUTER_LENGTH_META_PRESENT",
      score: 10,
      note: `outer length hint: ${normalizedMeta.outer.length}`,
    })
  }

  if (normalizedMeta.dress?.length && hasDress) {
    lengthScore += 12
    scoreParts.push({
      code: "DRESS_LENGTH_META_PRESENT",
      score: 12,
      note: `dress length hint: ${normalizedMeta.dress.length}`,
    })
  }

  if (hasDress && (hasTop || hasBottom)) {
    warnings.push({
      code: "MIXED_DRESS_AND_SEPARATES",
      message: "Dress and separate garments were mixed in one request.",
    })
    stabilityScore -= 12
  }

  if (!resultUrl) {
    warnings.push({
      code: "NO_RESULT_URL",
      message: "No result URL returned from try-on engine.",
    })
    total = 0
    detailScore = 0
    stabilityScore = 0
    lengthScore = 0
  }

  const retryBonus = s3Clamp((attemptIndex - 1) * 2, 0, 4)

  total = s3Clamp(
    total + lengthScore + detailScore + stabilityScore + retryBonus,
    0,
    100
  )

  if (total < 55) {
    warnings.push({
      code: "LOW_CONFIDENCE_SELECTION",
      message: "The output is below the confidence threshold.",
    })
  }

  return {
    total,
    pass: total >= 70,
    warning: total >= 55 && total < 70,
    scoreParts,
    warnings,
    summary: {
      base: 60,
      lengthScore,
      detailScore,
      stabilityScore,
      retryBonus,
    },
  }
}

function s3ShouldRetry(score, retryPolicy, attemptIndex) {
  if (!retryPolicy?.enabled) return false
  if (!score) return attemptIndex < retryPolicy.maxAttempts
  if (attemptIndex >= retryPolicy.maxAttempts) return false
  if (score.total >= retryPolicy.passScore) return false
  return true
}

function s3PickBestAttempt(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return null

  const sorted = [...attempts].sort((a, b) => {
    const aScore = s3ToNumber(a?.score?.total, 0)
    const bScore = s3ToNumber(b?.score?.total, 0)
    if (bScore !== aScore) return bScore - aScore

    const aAttempt = s3ToNumber(a?.attempt, 999)
    const bAttempt = s3ToNumber(b?.attempt, 999)
    return aAttempt - bAttempt
  })

  return sorted[0] || null
}

function s3CollectWarnings(attempts, retryPolicy) {
  const best = s3PickBestAttempt(attempts)
  const out = []

  if (!best) {
    out.push({
      code: "NO_ATTEMPTS",
      message: "No valid attempts were recorded.",
    })
    return out
  }

  for (const w of best?.score?.warnings || []) {
    out.push(w)
  }

  if (s3ToNumber(best?.score?.total, 0) < s3ToNumber(retryPolicy?.passScore, 70)) {
    out.push({
      code: "BEST_RESULT_BELOW_PASS_SCORE",
      message: `Best result score ${best?.score?.total ?? 0} is below pass score ${retryPolicy?.passScore ?? 70}.`,
    })
  }

  return out
}

function s3GetRequestDebugMeta(body) {
  const normalizedMeta = s3NormalizeLengthMeta(body?.meta || {})
  const retryPolicy = s3NormalizeRetryPolicy(body?.retry_policy || {})

  return {
    receivedAt: s3NowIso(),
    hasModelFront: !!body?.model_front,
    hasModelBack: !!body?.model_back,
    hasTopFront: !!body?.top_front,
    hasTopBack: !!body?.top_back,
    hasBottomFront: !!body?.bottom_front,
    hasBottomBack: !!body?.bottom_back,
    hasOuterFront: !!body?.outer_front,
    hasOuterBack: !!body?.outer_back,
    hasDressFront: !!body?.dress_front,
    hasDressBack: !!body?.dress_back,
    debug: !!body?.debug,
    seed: typeof body?.seed === "number" ? body.seed : null,
    prompt_mode: s3NormalizePromptMode(body?.prompt_mode),
    meta: normalizedMeta,
    retry_policy: retryPolicy,
  }
}

function s3NormalizeInputs(body) {
  const src = body && typeof body === "object" ? body : {}

  const models = {
    front: src.model_front || "",
    back: src.model_back || "",
  }

  const garmentsByView = {
    front: {
      top: src.top_front || "",
      bottom: src.bottom_front || "",
      outer: src.outer_front || "",
      dress: src.dress_front || "",
    },
    back: {
      top: src.top_back || "",
      bottom: src.bottom_back || "",
      outer: src.outer_back || "",
      dress: src.dress_back || "",
    },
  }

  return {
    models,
    garmentsByView,
    debug: !!src.debug,
    seed: Number.isFinite(src.seed) ? Math.floor(src.seed) : 42,
    promptMode: s3NormalizePromptMode(src.prompt_mode),
    meta: s3NormalizeLengthMeta(src.meta || {}),
    retryPolicy: s3NormalizeRetryPolicy(src.retry_policy || {}),
  }
}

function s3ValidateInputs(norm) {
  const errors = []

  if (!norm.models.front && !norm.models.back) {
    errors.push("At least one model image is required: model_front or model_back")
  }

  for (const view of S3_VIEWS) {
    const m = norm.models[view]
    if (m && !s3IsHttpUrl(m) && !s3IsDataUrl(m)) {
      errors.push(`model_${view} must be a public URL or data URL`)
    }

    for (const slot of ["top", "bottom", "outer", "dress"]) {
      const g = norm.garmentsByView[view][slot]
      if (g && !s3IsHttpUrl(g) && !s3IsDataUrl(g)) {
        errors.push(`${slot}_${view} must be a public URL or data URL`)
      }
    }
  }

  return errors
}

/* ============================================================
 * ✅ Cloudflare Images helpers
 * ============================================================
 */

function s3GuessMimeFromFilename(filename = "") {
  const lower = String(filename).toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  return "image/jpeg"
}

function s3DataUrlToBuffer(dataUrl) {
  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/)
  if (!match) {
    throw new Error("Invalid data URL")
  }
  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
  }
}

async function s3UploadBufferToCloudflareImages(
  buffer,
  filename = "upload.jpg",
  mime = "image/jpeg"
) {
  if (!CF_ACCOUNT_ID || !CF_IMAGES_TOKEN) {
    throw new Error("Cloudflare Images env is missing")
  }

  const form = new FormData()
  const blob = new Blob([buffer], { type: mime })
  form.append("file", blob, filename)

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v1`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_IMAGES_TOKEN}`,
      },
      body: form,
    }
  )

  const text = await res.text()
  let json = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  if (!res.ok || !json?.success) {
    const msg =
      json?.errors?.[0]?.message ||
      json?.result?.message ||
      json?.message ||
      "Cloudflare Images upload failed"

    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg))
  }

  const variants = Array.isArray(json?.result?.variants)
    ? json.result.variants
    : []

  const preferredUrl =
    variants.find((v) => /\/original(?:\/|$)/i.test(v)) ||
    variants.find((v) => /\/public(?:\/|$)/i.test(v)) ||
    variants[0] ||
    ""

  if (!preferredUrl) {
    throw new Error("Cloudflare Images did not return a public variant URL")
  }

  return {
    id: json?.result?.id || "",
    filename: json?.result?.filename || filename,
    uploaded: json,
    url: preferredUrl,
  }
}

async function s3FetchRemoteImageAsBuffer(url) {
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Failed to fetch remote image: ${res.status}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  const contentType = res.headers.get("content-type") || "image/png"

  return {
    buffer: Buffer.from(arrayBuffer),
    mime: contentType,
  }
}

async function s3ProbeImageSizeFromUrl(url, timeoutMs = 8000) {
  let timer = null

  try {
    const controller = new AbortController()
    timer = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const meta = await sharp(buffer).metadata()

    return {
      ok: true,
      url,
      width: meta.width || 0,
      height: meta.height || 0,
      format: meta.format || "",
      sizeBytes: buffer.length || 0,
    }
  } catch (err) {
    return {
      ok: false,
      url,
      error: err?.name === "AbortError"
        ? `Probe timeout after ${timeoutMs}ms`
        : err?.message || String(err),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function s3UploadRemoteResultToCloudflare(url, filename = "result.png") {
  if (!url || !s3IsHttpUrl(url)) {
    throw new Error("Remote result URL is missing or invalid")
  }

  const fetched = await s3FetchRemoteImageAsBuffer(url)

  const mime =
    fetched.mime && String(fetched.mime).startsWith("image/")
      ? fetched.mime
      : s3GuessMimeFromFilename(filename)

  const ext =
    mime === "image/png"
      ? "png"
      : mime === "image/webp"
      ? "webp"
      : mime === "image/jpeg"
      ? "jpg"
      : "png"

  const safeFilename = filename.includes(".")
    ? filename
    : `result.${ext}`

  return s3UploadBufferToCloudflareImages(fetched.buffer, safeFilename, mime)
}

function s3EmptyAsset() {
  return {
    id: "",
    url: "",
    filename: "",
  }
}

/* ============================================================
 * ✅ INPUT normalize helpers
 * ============================================================
 */

async function s3NormalizeImageInput(input, _options = {}) {
  if (!input) return ""

  if (s3IsHttpUrl(input)) return input
  if (s3IsDataUrl(input)) return input

  throw new Error("Unsupported image input. Only public URL or data URL is allowed.")
}

async function s3PreprocessAll(norm) {
  const prepared = {
    models: { front: "", back: "" },
    garmentsByView: {
      front: { top: "", bottom: "", outer: "", dress: "" },
      back: { top: "", bottom: "", outer: "", dress: "" },
    },
  }

  for (const view of S3_VIEWS) {
    const modelInput = norm.models[view]

    if (s3IsDataUrl(modelInput)) {
      const parsed = s3DataUrlToBuffer(modelInput)

      const ext =
        parsed.mime === "image/png"
          ? "png"
          : parsed.mime === "image/webp"
          ? "webp"
          : "jpg"

      const uploaded = await s3UploadBufferToCloudflareImages(
        parsed.buffer,
        `model-${view}-${Date.now()}.${ext}`,
        parsed.mime
      )

      prepared.models[view] = uploaded.url
    } else {
      prepared.models[view] = modelInput || ""
    }

    for (const slot of ["top", "bottom", "outer", "dress"]) {
      const garmentInput = norm.garmentsByView[view][slot]

      if (s3IsDataUrl(garmentInput)) {
        const parsed = s3DataUrlToBuffer(garmentInput)

        const ext =
          parsed.mime === "image/png"
            ? "png"
            : parsed.mime === "image/webp"
            ? "webp"
            : "jpg"

        const uploaded = await s3UploadBufferToCloudflareImages(
          parsed.buffer,
          `${slot}-${view}-${Date.now()}.${ext}`,
          parsed.mime
        )

        prepared.garmentsByView[view][slot] = uploaded.url
      } else {
        prepared.garmentsByView[view][slot] = garmentInput || ""
      }
    }
  }

  return prepared
}

/* ============================================================
 * ✅ FASHN helpers
 * ============================================================
 */

async function s3FashnRunTryOnMax({
  modelImage,
  productImage,
  prompt = "",
  seed = 42,
  numImages = 1,
  outputFormat = "png",
  returnBase64 = false,
  resolution = "2k",
  generationMode = "quality",
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
      resolution,
      generation_mode: generationMode,
    },
  }

  const res = await fetch(FASHN_RUN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.FASHN_API_KEY || ""}`,
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

async function s3FashnPollPrediction(id, opts = {}) {
  const intervalMs = Number(opts.intervalMs || S3_DEFAULT_POLL_INTERVAL_MS)
  const timeoutMs = Number(opts.timeoutMs || S3_DEFAULT_POLL_TIMEOUT_MS)
  const started = Date.now()

  for (;;) {
    const res = await fetch(FASHN_STATUS_URL(id), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.FASHN_API_KEY || ""}`,
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
        (Array.isArray(json?.output) ? json.output[0] : null) ||
        outputs?.images?.[0] ||
        outputs?.image ||
        outputs?.url ||
        json?.output_image ||
        json?.image ||
        json?.result?.image ||
        json?.result?.url ||
        null

      return {
        status,
        raw: json,
        finalImage: finalImage || null,
      }
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

    await s3Sleep(intervalMs)
  }
}

async function s3RunTryOnStep({
  slot,
  inputModel,
  garment,
  seed,
  promptMode,
  debug = false,
}) {
  const prompt = promptMode === "short" ? s3ShortPromptForSlot(slot) : ""

  if (!inputModel) {
    throw new Error(`Missing inputModel for slot ${slot}`)
  }

  if (!garment) {
    throw new Error(`Missing garment for slot ${slot}`)
  }

  ("[TRYON_STEP_INPUT]", {
    slot,
    inputModel,
    garment,
    seed,
    prompt,
    inputModelIsUrl: s3IsHttpUrl(inputModel),
    garmentIsUrl: s3IsHttpUrl(garment),
  })

  const run = await s3FashnRunTryOnMax({
  modelImage: inputModel,
  productImage: garment,
  prompt,
  seed,
  numImages: 1,
  outputFormat: "png",
  returnBase64: false,
  resolution: "2k",
  generationMode: "quality",
})

  const done = await s3FashnPollPrediction(run.id)

  ("[TRYON_MAX_RUN_PAYLOAD]", JSON.stringify(run.payload, null, 2))
  ("[TRYON_MAX_STATUS_RAW]", JSON.stringify(done.raw, null, 2))
  ("[TRYON_MAX_FINAL_IMAGE]", done.finalImage)

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

async function s3RunTryOnStepWithRetry(args, retryCount = S3_DEFAULT_RETRY_COUNT) {
  let lastErr = null

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const seed = (args.seed || 42) + attempt

    try {
      const out = await s3RunTryOnStep({
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
      const msg = s3SafeErrMessage(err)

      console.error("[TRYON_STEP_RETRY_ERROR]", {
        slot: args?.slot || "",
        attempt: attempt + 1,
        error: msg,
      })

      if (
        /out of credits/i.test(msg) ||
        /purchase more/i.test(msg) ||
        /insufficient/i.test(msg) ||
        /payment/i.test(msg) ||
        /unauthorized/i.test(msg) ||
        /forbidden/i.test(msg) ||
        /invalid api key/i.test(msg)
      ) {
        break
      }

      if (attempt >= retryCount) break
    }
  }

  return {
    ok: false,
    error: s3SafeErrMessage(lastErr),
    attempts: Math.min(retryCount + 1, lastErr ? retryCount + 1 : 1),
  }
}

async function s3RunSequentialViewSingleAttempt({
  view,
  modelImage,
  garments,
  seed,
  promptMode,
  debug,
}) {
  const plan = s3BuildPlanForView({ [view]: garments }, view)

  ("[SEQUENTIAL_VIEW_START]", {
    view,
    hasModel: !!modelImage,
    garments: {
      top: !!garments?.top,
      bottom: !!garments?.bottom,
      outer: !!garments?.outer,
      dress: !!garments?.dress,
    },
    plan,
  })

  if (!modelImage) {
    return {
      ok: false,
      view,
      error: `model_${view} is missing`,
      plan,
      finalUrl: "",
      finalCloudflare: s3EmptyAsset(),
      steps: [],
    }
  }

  if (plan.length === 0) {
    return {
      ok: true,
      view,
      plan,
      finalUrl: modelImage,
      finalCloudflare: s3EmptyAsset(),
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

    const result = await s3RunTryOnStepWithRetry(
      {
        slot,
        inputModel: currentModel,
        garment,
        seed: seed + i,
        promptMode,
        debug,
      },
      S3_DEFAULT_RETRY_COUNT
    )

    if (!result.ok) {
      return {
        ok: false,
        view,
        plan,
        finalUrl: currentModel,
        finalCloudflare: s3EmptyAsset(),
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

  let finalCloudflare = s3EmptyAsset()
  let finalUrl = currentModel || ""

  if (currentModel && s3IsHttpUrl(currentModel)) {
    try {
      finalCloudflare = await s3UploadRemoteResultToCloudflare(
        currentModel,
        `dress-${view}-${Date.now()}.png`
      )
    } catch (cfErr) {
      console.error("[S3_CF_UPLOAD_FAILED]", {
        view,
        error: s3SafeErrMessage(cfErr),
      })
      finalCloudflare = s3EmptyAsset()
    }
  }

  return {
    ok: true,
    view,
    plan,
    finalUrl,
    finalCloudflare,
    steps,
  }
}

async function s3RunSequentialViewWithRetry({
  view,
  modelImage,
  garments,
  seed,
  promptMode,
  debug,
  meta,
  retryPolicy,
}) {
  const attempts = []

  const hasAnyGarment =
    !!garments?.top || !!garments?.bottom || !!garments?.outer || !!garments?.dress

  if (!modelImage && !hasAnyGarment) {
    return {
      ok: false,
      skipped: true,
      skipReason: `${view} skipped: model and garments are missing`,
      view,
      attempts: [],
      bestAttempt: null,
      warnings: [
        {
          code: "VIEW_SKIPPED_EMPTY_INPUT",
          message: `${view} was skipped because both model and garments are missing.`,
        },
      ],
      finalUrl: "",
      finalCloudflare: s3EmptyAsset(),
      steps: [],
      plan: [],
      score: null,
      error: "",
    }
  }

  if (!modelImage && hasAnyGarment) {
    return {
      ok: false,
      skipped: false,
      skipReason: "",
      view,
      attempts: [],
      bestAttempt: null,
      warnings: [],
      finalUrl: "",
      finalCloudflare: s3EmptyAsset(),
      steps: [],
      plan: [],
      score: null,
      error: `model_${view} is missing`,
    }
  }

  if (modelImage && !hasAnyGarment) {
    return {
      ok: false,
      skipped: true,
      skipReason: `${view} skipped: no garments uploaded`,
      view,
      attempts: [],
      bestAttempt: null,
      warnings: [
        {
          code: "VIEW_SKIPPED_NO_GARMENTS",
          message: `${view} was skipped because no garments were uploaded.`,
        },
      ],
      finalUrl: "",
      finalCloudflare: s3EmptyAsset(),
      steps: [],
      plan: [],
      score: null,
      error: "",
    }
  }

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
    try {
      const single = await s3RunSequentialViewSingleAttempt({
        view,
        modelImage,
        garments,
        seed: seed + (attempt - 1) * 100,
        promptMode,
        debug,
      })

      const score = single?.ok
        ? s3ScoreMetaMatch({
            meta,
            garments,
            view,
            resultUrl: single?.finalUrl || single?.finalCloudflare?.url || "",
            attemptIndex: attempt,
          })
        : {
            total: 0,
            pass: false,
            warning: false,
            scoreParts: [],
            warnings: [
              {
                code: "ATTEMPT_FAILED",
                message: single?.error || "Attempt failed",
              },
            ],
            summary: {
              base: 0,
              lengthScore: 0,
              detailScore: 0,
              stabilityScore: 0,
              retryBonus: 0,
            },
          }

      attempts.push({
        attempt,
        ok: !!single?.ok,
        finalUrl: single?.ok ? (single?.finalUrl || "") : "",
        finalCloudflare: single?.ok
          ? (single?.finalCloudflare || s3EmptyAsset())
          : s3EmptyAsset(),
        steps: Array.isArray(single?.steps) ? single.steps : [],
        plan: single?.plan || [],
        failedStep: single?.failedStep || "",
        warning: single?.warning || "",
        error: single?.error || "",
        score,
      })

      ("[VIEW_ATTEMPT_RESULT]", {
        view,
        attempt,
        ok: !!single?.ok,
        stepCount: Array.isArray(single?.steps) ? single.steps.length : 0,
        failedStep: single?.failedStep || "",
        error: single?.error || "",
        finalUrl: single?.ok ? (single?.finalUrl || "") : "",
        score: score?.total ?? null,
      })

      if (single?.ok && !s3ShouldRetry(score, retryPolicy, attempt)) {
        break
      }

      if (!single?.ok) {
        const msg = String(single?.error || "")
        if (
          /out of credits/i.test(msg) ||
          /purchase more/i.test(msg) ||
          /insufficient/i.test(msg) ||
          /payment/i.test(msg) ||
          /unauthorized/i.test(msg) ||
          /forbidden/i.test(msg) ||
          /invalid api key/i.test(msg)
        ) {
          break
        }
      }
    } catch (err) {
      const fatalMessage = s3SafeErrMessage(err)

      attempts.push({
        attempt,
        ok: false,
        finalUrl: "",
        finalCloudflare: s3EmptyAsset(),
        steps: [],
        plan: [],
        failedStep: "",
        warning: "",
        error: fatalMessage,
        score: {
          total: 0,
          pass: false,
          warning: false,
          scoreParts: [],
          warnings: [
            {
              code: "ATTEMPT_FAILED",
              message: fatalMessage,
            },
          ],
          summary: {
            base: 0,
            lengthScore: 0,
            detailScore: 0,
            stabilityScore: 0,
            retryBonus: 0,
          },
        },
      })

      console.error("[VIEW_ATTEMPT_FATAL_ERROR]", {
        view,
        attempt,
        error: fatalMessage,
      })

      if (
        /out of credits/i.test(fatalMessage) ||
        /purchase more/i.test(fatalMessage) ||
        /insufficient/i.test(fatalMessage) ||
        /payment/i.test(fatalMessage) ||
        /unauthorized/i.test(fatalMessage) ||
        /forbidden/i.test(fatalMessage) ||
        /invalid api key/i.test(fatalMessage)
      ) {
        break
      }
    }
  }

  const bestAttempt = s3PickBestAttempt(attempts)
  const warnings = s3CollectWarnings(attempts, retryPolicy)

  if (!bestAttempt || !bestAttempt?.finalUrl) {
    const realError =
      bestAttempt?.error ||
      attempts.find((a) => a?.error)?.error ||
      `No usable ${view} result after retries`

    return {
      ok: false,
      skipped: false,
      skipReason: "",
      view,
      attempts,
      bestAttempt,
      warnings,
      finalUrl: "",
      finalCloudflare: s3EmptyAsset(),
      steps: [],
      plan: bestAttempt?.plan || [],
      score: null,
      error: realError,
    }
  }

  return {
    ok: true,
    skipped: false,
    skipReason: "",
    view,
    attempts,
    bestAttempt,
    warnings,
    finalUrl: bestAttempt.finalUrl || bestAttempt.finalCloudflare?.url || "",
    finalCloudflare: bestAttempt.finalCloudflare || s3EmptyAsset(),
    steps: bestAttempt.steps || [],
    plan: bestAttempt.plan || [],
    score: bestAttempt.score || null,
    error: "",
  }
}

/* ============================================================
 * ✅ Routes
 * ============================================================
 */

app.post("/api/dress-max", async (req, res) => {
  const startedAt = Date.now()
  const requestMeta = s3GetRequestDebugMeta(req.body)

  try {
    if (!process.env.FASHN_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Server is missing FASHN_API_KEY",
      })
    }

    if (!CF_ACCOUNT_ID || !CF_IMAGES_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "Server is missing Cloudflare Images env",
      })
    }

    const norm = s3NormalizeInputs(req.body)
    const errors = s3ValidateInputs(norm)

    console.log("===================================")
    console.log("[RAW BODY KEYS]", Object.keys(req.body || {}))
    console.log("[RAW BODY GARMENTS]", {
      top_front: !!req.body?.top_front,
      bottom_front: !!req.body?.bottom_front,
      outer_front: !!req.body?.outer_front,
      dress_front: !!req.body?.dress_front,
      top_back: !!req.body?.top_back,
      bottom_back: !!req.body?.bottom_back,
      outer_back: !!req.body?.outer_back,
      dress_back: !!req.body?.dress_back,
    })
    console.log("[RAW BODY MODELS]", {
      model_front: !!req.body?.model_front,
      model_back: !!req.body?.model_back,
    })
    console.log("===================================")

    if (errors.length) {
      return res.status(400).json({
        ok: false,
        error: "Invalid request",
        details: errors,
      })
    }

    console.log("[/api/dress-max] meta =", JSON.stringify(norm.meta, null, 2))
    console.log(
      "[/api/dress-max] retryPolicy =",
      JSON.stringify(norm.retryPolicy, null, 2)
    )

    console.log("[S3] before preprocess")
    const prepared = await s3PreprocessAll(norm)
    console.log("[S3] after preprocess")

    console.log("[S3] before input probe")
    const inputProbe = {
      frontModel: prepared.models.front
        ? await s3ProbeImageSizeFromUrl(prepared.models.front, 8000)
        : null,
      frontBottom: prepared.garmentsByView.front.bottom
        ? await s3ProbeImageSizeFromUrl(
            prepared.garmentsByView.front.bottom,
            8000
          )
        : null,
    }
    console.log("[S3] after input probe", JSON.stringify(inputProbe, null, 2))

    console.log("===================================")
    console.log("[S3 INPUT DEBUG]")
    console.log("model_front:", prepared.models.front)
    console.log("model_back:", prepared.models.back)
    console.log(
      "garment_front:",
      JSON.stringify(prepared.garmentsByView.front, null, 2)
    )
    console.log(
      "garment_back:",
      JSON.stringify(prepared.garmentsByView.back, null, 2)
    )
    console.log("[S3 INPUT TYPE CHECK]", {
      model_front_is_url: s3IsHttpUrl(prepared.models.front),
      model_back_is_url: s3IsHttpUrl(prepared.models.back),
      top_front_is_url: s3IsHttpUrl(prepared.garmentsByView.front.top),
      bottom_front_is_url: s3IsHttpUrl(prepared.garmentsByView.front.bottom),
      outer_front_is_url: s3IsHttpUrl(prepared.garmentsByView.front.outer),
      dress_front_is_url: s3IsHttpUrl(prepared.garmentsByView.front.dress),
      top_back_is_url: s3IsHttpUrl(prepared.garmentsByView.back.top),
      bottom_back_is_url: s3IsHttpUrl(prepared.garmentsByView.back.bottom),
      outer_back_is_url: s3IsHttpUrl(prepared.garmentsByView.back.outer),
      dress_back_is_url: s3IsHttpUrl(prepared.garmentsByView.back.dress),
    })
    console.log("===================================")

    console.log("[S3] before run tryon")
    const frontPromise = s3RunSequentialViewWithRetry({
      view: "front",
      modelImage: prepared.models.front,
      garments: prepared.garmentsByView.front,
      seed: norm.seed,
      promptMode: norm.promptMode,
      debug: norm.debug,
      meta: norm.meta,
      retryPolicy: norm.retryPolicy,
    })

    const backPromise = s3RunSequentialViewWithRetry({
      view: "back",
      modelImage: prepared.models.back,
      garments: prepared.garmentsByView.back,
      seed: norm.seed + 1000,
      promptMode: norm.promptMode,
      debug: norm.debug,
      meta: norm.meta,
      retryPolicy: norm.retryPolicy,
    })

    const [front, back] = await Promise.all([frontPromise, backPromise])

    const frontProbe = front?.finalUrl
      ? await s3ProbeImageSizeFromUrl(front.finalUrl, 8000)
      : null

    const backProbe = back?.finalUrl
      ? await s3ProbeImageSizeFromUrl(back.finalUrl, 8000)
      : null

    console.log("[S3 OUTPUT SIZE PROBE]", {
      front: frontProbe,
      back: backProbe,
    })

    console.log("===================================")
    console.log("[S3 RESULT DEBUG]")
    console.log("front raw:", JSON.stringify(front, null, 2))
    console.log("back raw:", JSON.stringify(back, null, 2))
    console.log("===================================")

    return res.json({
      ok: !!front?.ok || !!back?.ok,
      mode: "tryon-max",

      front: {
        ok: !!front?.ok,
        finalUrl: front?.finalUrl || "",
        finalCloudflare: front?.finalCloudflare || s3EmptyAsset(),
        steps: front?.steps || [],
        plan: front?.plan || [],
        attempts: front?.attempts || [],
        bestAttempt: front?.bestAttempt || null,
        warnings: front?.warnings || [],
        score: front?.score || null,
        probe: frontProbe,
        error: front?.error || "",
      },

      back: {
        ok: !!back?.ok,
        finalUrl: back?.finalUrl || "",
        finalCloudflare: back?.finalCloudflare || s3EmptyAsset(),
        steps: back?.steps || [],
        plan: back?.plan || [],
        attempts: back?.attempts || [],
        bestAttempt: back?.bestAttempt || null,
        warnings: back?.warnings || [],
        score: back?.score || null,
        probe: backProbe,
        error: back?.error || "",
      },

      assets: {
        front: front?.finalCloudflare || s3EmptyAsset(),
        back: back?.finalCloudflare || s3EmptyAsset(),
      },

      debug: {
        rawBody: {
          model_front: !!req.body?.model_front,
          model_back: !!req.body?.model_back,
          top_front: !!req.body?.top_front,
          bottom_front: !!req.body?.bottom_front,
          outer_front: !!req.body?.outer_front,
          dress_front: !!req.body?.dress_front,
          top_back: !!req.body?.top_back,
          bottom_back: !!req.body?.bottom_back,
          outer_back: !!req.body?.outer_back,
          dress_back: !!req.body?.dress_back,
        },
        prepared: {
          model_front: !!prepared.models.front,
          model_back: !!prepared.models.back,
          garments_front: s3Pick(prepared.garmentsByView.front, [
            "top",
            "bottom",
            "outer",
            "dress",
          ]),
          garments_back: s3Pick(prepared.garmentsByView.back, [
            "top",
            "bottom",
            "outer",
            "dress",
          ]),
        },
        inputProbe,
        output: {
          front_ok: !!front?.ok,
          front_error: front?.error || "",
          front_steps: Array.isArray(front?.steps) ? front.steps.length : 0,
          front_url: front?.finalUrl || "",
          back_ok: !!back?.ok,
          back_error: back?.error || "",
          back_steps: Array.isArray(back?.steps) ? back.steps.length : 0,
          back_url: back?.finalUrl || "",
          front_probe: frontProbe,
          back_probe: backProbe,
        },
      },

      meta: {
        request: requestMeta,
        normalizedMeta: norm.meta,
        retryPolicy: norm.retryPolicy,
        elapsedMs: Date.now() - startedAt,
      },
    })
  } catch (err) {
    console.error("[/api/dress-max] ERROR:", err)

    return res.status(500).json({
      ok: false,
      error: s3SafeErrMessage(err),
      meta: {
        request: requestMeta,
        elapsedMs: Date.now() - startedAt,
      },
    })
  }
})

app.post("/api/dress-v16-test", async (req, res) => {
  const startedAt = Date.now()

  try {
    if (!process.env.FASHN_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Server is missing FASHN_API_KEY",
      })
    }

    if (!CF_ACCOUNT_ID || !CF_IMAGES_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "Server is missing Cloudflare Images env",
      })
    }

    const {
      model_front,
      top_front,
      bottom_front,
      dress_front,
      seed = 42,
      garment_photo_type = "auto",
      mode = "quality",
      debug = true,
    } = req.body || {}

    const modelImage = model_front || ""
    const topImage = top_front || ""
    const bottomImage = bottom_front || ""
    const dressImage = dress_front || ""

    if (!modelImage || (!topImage && !bottomImage && !dressImage)) {
      return res.status(400).json({
        ok: false,
        error: "model_front and one garment(top_front/bottom_front/dress_front) are required",
      })
    }

    if (!s3IsHttpUrl(modelImage) && !s3IsDataUrl(modelImage)) {
      return res.status(400).json({
        ok: false,
        error: "model_front must be a public URL or data URL",
      })
    }

    let garmentImage = ""
    let category = "auto"
    let slot = ""

    if (s3IsDataUrl(topImage) || s3IsHttpUrl(topImage)) {
      garmentImage = topImage
      category = "tops"
      slot = "top"
    } else if (s3IsDataUrl(bottomImage) || s3IsHttpUrl(bottomImage)) {
      garmentImage = bottomImage
      category = "bottoms"
      slot = "bottom"
    } else if (s3IsDataUrl(dressImage) || s3IsHttpUrl(dressImage)) {
      garmentImage = dressImage
      category = "one-pieces"
      slot = "dress"
    } else {
      return res.status(400).json({
        ok: false,
        error: "No valid garment image found",
      })
    }

    const preparedModel = await s3NormalizeImageInput(modelImage)
    const preparedGarment = await s3NormalizeImageInput(garmentImage)

    const payload = {
      model_name: "tryon-v1.6",
      inputs: {
        model_image: preparedModel,
        garment_image: preparedGarment,
        category,
        garment_photo_type,
        mode,
        seed,
        num_samples: 1,
        output_format: "png",
        return_base64: false,
      },
    }

    const resRun = await fetch(FASHN_RUN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.FASHN_API_KEY || ""}`,
      },
      body: JSON.stringify(payload),
    })

    const runText = await resRun.text()
    let runJson = null

    try {
      runJson = runText ? JSON.parse(runText) : null
    } catch {
      runJson = { raw: runText }
    }

    if (!resRun.ok) {
      const msg =
        runJson?.error?.message ||
        runJson?.message ||
        runJson?.error ||
        `FASHN v1.6 run failed with ${resRun.status}`

      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg))
    }

    const predictionId =
      runJson?.id ||
      runJson?.prediction_id ||
      runJson?.data?.id ||
      runJson?.result?.id ||
      ""

    if (!predictionId) {
      throw new Error("FASHN v1.6 response did not include prediction id")
    }

    const done = await s3FashnPollPrediction(predictionId)

    let finalCloudflare = s3EmptyAsset()
    if (done.finalImage && s3IsHttpUrl(done.finalImage)) {
      try {
        finalCloudflare = await s3UploadRemoteResultToCloudflare(
          done.finalImage,
          `dress-v16-${slot}-${Date.now()}.png`
        )
      } catch (cfErr) {
        console.error("[DRESS_V16_CF_UPLOAD_FAILED]", {
          slot,
          error: s3SafeErrMessage(cfErr),
        })
      }
    }

    return res.json({
      ok: true,
      mode: "tryon-v1.6",
      slot,
      category,
      finalUrl: done.finalImage || null,
      finalCloudflare,
      predictionId,
      meta: {
        elapsedMs: Date.now() - startedAt,
        garment_photo_type,
        requestMode: mode,
        debug: !!debug,
        preparedModel,
        preparedGarment,
      },
      ...(debug
        ? {
            debugPayload: payload,
            debugRunRaw: runJson,
            debugStatusRaw: done.raw,
          }
        : {}),
    })
  } catch (err) {
    console.error("[/api/dress-v16-test] ERROR:", err)
    return res.status(500).json({
      ok: false,
      error: s3SafeErrMessage(err),
      meta: {
        elapsedMs: Date.now() - startedAt,
      },
    })
  }
})

app.get("/api/cf-check", async (_req, res) => {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || ""
    const token = process.env.CLOUDFLARE_IMAGES_TOKEN || ""

    if (!accountId || !token) {
      return res.status(500).json({
        ok: false,
        error: "Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_IMAGES_TOKEN",
      })
    }

    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    )

    const text = await r.text()
    let json = null

    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }

    return res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      accountId,
      response: json,
    })
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    })
  }
})

app.post("/api/cf-upload-check", async (req, res) => {
  try {
    const { image } = req.body || {}

    if (!image) {
      return res.status(400).json({
        ok: false,
        error: "image(data URL or public URL) is required",
      })
    }

    let uploaded = s3EmptyAsset()

    if (s3IsDataUrl(image)) {
      const parsed = s3DataUrlToBuffer(image)

      const ext =
        parsed.mime === "image/png"
          ? "png"
          : parsed.mime === "image/webp"
          ? "webp"
          : "jpg"

      uploaded = await s3UploadBufferToCloudflareImages(
        parsed.buffer,
        `cf-upload-check.${ext}`,
        parsed.mime
      )
    } else if (s3IsHttpUrl(image)) {
      uploaded = await s3UploadRemoteResultToCloudflare(
        image,
        "cf-upload-check.png"
      )
    } else {
      return res.status(400).json({
        ok: false,
        error: "image must be a data URL or public URL",
      })
    }

    return res.json({
      ok: true,
      uploaded,
    })
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: s3SafeErrMessage(err),
    })
  }
})

const PORT = Number(process.env.PORT || 10000)

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[BOOT] Server listening on :${PORT}`)
})
