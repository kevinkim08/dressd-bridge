import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

if (typeof globalThis.fetch !== "function") {
  console.warn("[WARN] fetch not available. Use Node 18+")
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

/* =============================
   Credits (MVP in-memory)
============================= */

const DEFAULT_BALANCE = 1000
const balances = new Map()
const reservations = new Map()

function now() {
  return Date.now()
}

function getClientId(req) {
  const id = req.header("X-Client-Id")
  if (!id) throw new Error("Missing X-Client-Id")
  return id
}

function getBalance(clientId) {
  if (!balances.has(clientId)) balances.set(clientId, DEFAULT_BALANCE)
  return balances.get(clientId)
}

function setBalance(clientId, v) {
  balances.set(clientId, v)
}

app.post("/api/credits/reserve", (req, res) => {
  try {
    const clientId = getClientId(req)
    const amount = Number(req.body?.amount || 0)

    if (getBalance(clientId) < amount) {
      return res.status(402).json({ error: "insufficient_credits" })
    }

    setBalance(clientId, getBalance(clientId) - amount)

    const reservationId = `r_${now()}_${Math.random()
      .toString(16)
      .slice(2)}`

    reservations.set(reservationId, {
      reservationId,
      clientId,
      amount,
      status: "reserved",
    })

    return res.json({ reservationId })
  } catch (e) {
    return res.status(400).json({ error: String(e?.message ?? e) })
  }
})

/* =============================
   Imagen
============================= */

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

function mustHaveToken(res) {
  if (!process.env.REPLICATE_API_TOKEN) {
    res.status(500).json({ error: "REPLICATE_API_TOKEN missing" })
    return false
  }
  return true
}

function pickImageUrl(output) {
  if (Array.isArray(output)) {
    const first = output[0]
    if (typeof first === "string") return first
    if (first?.url) return first.url
  }
  if (typeof output === "string") return output
  if (output?.url) return output.url
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

/* =============================
   Prompt Locks
============================= */

function lockFront(prompt) {
  return [
    prompt,
    "strict front view only",
    "camera directly in front",
    "subject facing camera",
    "full body visible head to toe",
    "feet fully visible",
    "wide framing",
    "not cropped",
    "not close-up",
  ].join(", ")
}

function lockBack(prompt) {
  return [
    prompt,
    "strict back view only",
    "rear view only",
    "camera directly behind subject",
    "subject facing away from camera",
    "no face visible",
    "no three quarter angle",
    "no side angle",
    "full body visible head to toe",
    "feet fully visible",
    "wide framing",
    "not cropped",
    "not close-up",
    "hair falling straight down the back",
    "hair centered",
    "no hair over shoulders",
    "no wind",
    "no motion",
  ].join(", ")
}

/* =============================
   Basic Validation
============================= */

function basicValidate(frontUrl, backUrl) {
  if (!frontUrl || !backUrl) return false
  if (frontUrl === backUrl) return false
  return true
}

/* =============================
   Retry Generator
============================= */

async function generatePairWithRetry(frontPrompt, backPrompt, maxRetry = 2) {
  for (let i = 0; i <= maxRetry; i++) {
    const front = await runImagen(frontPrompt)
    const back = await runImagen(backPrompt)

    if (basicValidate(front, back)) {
      return { front, back }
    }
  }
  return null
}

/* =============================
   S1 Pair Endpoint
============================= */

app.post("/api/s1/pair", async (req, res) => {
  const { prompt, reservationId } = req.body || {}
  if (!mustHaveToken(res)) return
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

  const r = reservations.get(reservationId)
  if (!r || r.status !== "reserved") {
    return res.status(400).json({ error: "Invalid reservation" })
  }

  try {
    const frontPrompt = lockFront(prompt)
    const backPrompt = lockBack(prompt)

    const result = await generatePairWithRetry(frontPrompt, backPrompt, 2)

    if (!result) {
      // 환불
      setBalance(r.clientId, getBalance(r.clientId) + r.amount)
      reservations.set(reservationId, {
        ...r,
        status: "released",
      })
      return res.status(502).json({
        error: "Invalid image output after retry",
      })
    }

    reservations.set(reservationId, {
      ...r,
      status: "committed",
    })

    return res.json({
      frontUrl: result.front,
      backUrl: result.back,
      reservationId,
    })
  } catch (e) {
    // 환불
    setBalance(r.clientId, getBalance(r.clientId) + r.amount)
    reservations.set(reservationId, {
      ...r,
      status: "released",
    })

    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
