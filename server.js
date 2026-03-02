import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

// ✅ Node 18+ 는 fetch 기본 제공.
// Render/로컬에서 Node 버전이 낮아 fetch가 없으면 에러나니까 안전장치.
if (typeof globalThis.fetch !== "function") {
  console.warn(
    "[WARN] fetch is not available. Use Node 18+ or add a fetch polyfill (undici/node-fetch)."
  )
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
  // ✅ 중요: 프론트에서 X-Client-Id 헤더를 보내므로 허용해야 함
  allowedHeaders: ["Content-Type", "Authorization", "X-Client-Id"],
}

app.use(cors(corsOptions))
app.options("*", cors(corsOptions))
app.use(express.json({ limit: "25mb" }))

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

/** -------------------------
 *  Credits (MVP B안: reserve/commit/release)
 *  - 로그인 없음: clientId(브라우저 localStorage)로 관리
 *  - 메모리 저장: 서버 재시작 시 초기화(현재 단계에 OK)
 *  ------------------------- */
const DEFAULT_BALANCE = 1000 // 테스트 기본 지급 (원하면 0으로)
const RESERVE_TTL_MS = 5 * 60 * 1000 // 5분

const balances = new Map() // clientId -> number
const reservations = new Map()
// reservationId -> { reservationId, clientId, amount, status, createdAt, expiresAt, reason, committedAt?, releasedAt?, releaseReason? }

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

function cleanupExpiredReservations() {
  const t = now()
  for (const [rid, r] of reservations.entries()) {
    if (r.status === "reserved" && r.expiresAt <= t) {
      // 만료면 자동 환불(=release)
      const bal = getBalance(r.clientId)
      setBalance(r.clientId, bal + r.amount)
      reservations.set(rid, {
        ...r,
        status: "released",
        releasedAt: t,
        releaseReason: "expired",
      })
    }
  }
}
setInterval(cleanupExpiredReservations, 15000)

app.post("/api/credits/balance", (req, res) => {
  try {
    const clientId = getClientId(req)
    return res.json({ clientId, balance: getBalance(clientId) })
  } catch (e) {
    return res.status(400).json({ error: String(e?.message ?? e) })
  }
})

app.post("/api/credits/reserve", (req, res) => {
  try {
    const clientId = getClientId(req)
    const amount = Number(req.body?.amount || 0)
    const reason = String(req.body?.reason || "")

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be > 0" })
    }

    const balance = getBalance(clientId)
    if (balance < amount) {
      return res.status(402).json({ error: "insufficient_credits", balance })
    }

    // reserve 시점에 hold 차감
    setBalance(clientId, balance - amount)

    const reservationId = `r_${now()}_${Math.random().toString(16).slice(2)}`
    const createdAt = now()
    const expiresAt = createdAt + RESERVE_TTL_MS

    reservations.set(reservationId, {
      reservationId,
      clientId,
      amount,
      status: "reserved",
      createdAt,
      expiresAt,
      reason,
    })

    return res.json({ reservationId, expiresAt, balance: getBalance(clientId) })
  } catch (e) {
    return res.status(400).json({ error: String(e?.message ?? e) })
  }
})

app.post("/api/credits/commit", (req, res) => {
  try {
    const clientId = getClientId(req)
    const reservationId = String(req.body?.reservationId || "")
    const r = reservations.get(reservationId)
    if (!r) return res.status(404).json({ error: "reservation_not_found" })
    if (r.clientId !== clientId) return res.status(403).json({ error: "forbidden" })

    if (r.status === "committed") {
      return res.json({ ok: true, idempotent: true, balance: getBalance(clientId) })
    }
    if (r.status !== "reserved") {
      return res.status(400).json({ error: `cannot_commit_status_${r.status}` })
    }

    reservations.set(reservationId, { ...r, status: "committed", committedAt: now() })
    return res.json({ ok: true, balance: getBalance(clientId) })
  } catch (e) {
    return res.status(400).json({ error: String(e?.message ?? e) })
  }
})

app.post("/api/credits/release", (req, res) => {
  try {
    const clientId = getClientId(req)
    const reservationId = String(req.body?.reservationId || "")
    const reason = String(req.body?.reason || "release")
    const r = reservations.get(reservationId)
    if (!r) return res.status(404).json({ error: "reservation_not_found" })
    if (r.clientId !== clientId) return res.status(403).json({ error: "forbidden" })

    if (r.status === "released") {
      return res.json({ ok: true, idempotent: true, balance: getBalance(clientId) })
    }
    if (r.status !== "reserved") {
      return res.status(400).json({ error: `cannot_release_status_${r.status}` })
    }

    // 환불(hold 되돌리기)
    setBalance(clientId, getBalance(clientId) + r.amount)

    reservations.set(reservationId, {
      ...r,
      status: "released",
      releasedAt: now(),
      releaseReason: reason,
    })

    return res.json({ ok: true, balance: getBalance(clientId) })
  } catch (e) {
    return res.status(400).json({ error: String(e?.message ?? e) })
  }
})

/** -------------------------
 *  S1 (Replicate / Imagen)
 *  ------------------------- */
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

/**
 * ✅ 텍스트/숫자/치수/인포그래픽 오버레이 방지
 */
function banTextOverlays(p) {
  return [
    p,
    "no text",
    "no typography",
    "no labels",
    "no captions",
    "no numbers",
    "no measurements",
    "no watermark",
    "no UI",
    "no infographic",
    "no chart",
    "no diagram",
  ].join(", ")
}

/**
 * ✅ 헤어 일관성(소폭 향상)
 * - 완벽 고정은 불가능하지만, 재추론 여지를 줄여서 색/웨이브 튐을 감소
 */
function enforceHairConsistency(p) {
  return [
    p,
    "same hairstyle",
    "same hair length",
    "same hair color",
    "consistent hair tone",
    "identical hair",
    "no hairstyle change",
  ].join(", ")
}

/**
 * ✅ view 충돌 제거
 */
function sanitizeViewConflicts(prompt, view) {
  let p = String(prompt || "")
  const clean = () => p.replace(/\s+/g, " ").trim()

  if (view === "back") {
    p = p.replace(/front view only/gi, "")
    p = p.replace(/front-facing/gi, "")
    p = p.replace(/not back view/gi, "")
    p = p.replace(/facing camera/gi, "")
    p = p.replace(/looking at camera/gi, "")
    p = p.replace(/camera-facing/gi, "")
    return clean()
  }

  p = p.replace(/back view only/gi, "")
  p = p.replace(/rear view/gi, "")
  p = p.replace(/not front view/gi, "")
  p = p.replace(/facing away/gi, "")
  p = p.replace(/back-facing/gi, "")
  return clean()
}

// ✅ FRONT/BACK 뷰를 강하게 고정
function withViewLock(prompt, view) {
  if (view === "back") {
    return [
      prompt,
      "back view only",
      "rear view",
      "standing straight",
      "full body",
      "head to toe",
      "feet visible",
      "not front view",
      "single person",
      "centered",
      "camera behind subject",
    ].join(", ")
  }
  return [
    prompt,
    "front view only",
    "front-facing",
    "standing straight",
    "full body",
    "head to toe",
    "feet visible",
    "not back view",
    "single person",
    "centered",
    "camera in front of subject",
  ].join(", ")
}

// ✅ Replicate output 형태가 케이스별로 달라서 최대한 안전하게 뽑기
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

// ✅ 기존 엔드포인트 유지: /api/s1 (FRONT 1장만)
app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body || {}
  if (!mustHaveToken(res)) return
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

  try {
    const base = withAdultGuard(prompt)
    const baseFront = sanitizeViewConflicts(base, "front")
    const finalPrompt = withViewLock(
      enforceHairConsistency(banTextOverlays(baseFront)),
      "front"
    )

    const imageUrl = await runImagen(finalPrompt)
    if (!imageUrl) return res.status(502).json({ error: "No imageUrl in output" })

    return res.json({ imageUrl, usedPrompt: finalPrompt })
  } catch (e) {
    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

/**
 * ✅ /api/s1/pair (최종)
 * - 입력 지원:
 *    1) { promptFront, promptBack, reservationId }  ← ✅ 권장
 *    2) { prompt, reservationId }                   ← fallback
 * - back이 계속 front로 나오는 문제를 줄이기 위해:
 *    - view별 sanitize
 *    - text overlay 금지 강제
 *    - hair consistency 소폭 강화
 *    - view lock 강화
 * - frontUrl===backUrl이면 실패 처리 + release(환불)
 */
app.post("/api/s1/pair", async (req, res) => {
  const { prompt, promptFront, promptBack, reservationId } = req.body || {}
  if (!mustHaveToken(res)) return

  // ✅ credit reservation 검증
  let clientId = null
  let r = null
  try {
    clientId = getClientId(req)
    if (!reservationId) return res.status(400).json({ error: "Missing reservationId" })
    r = reservations.get(String(reservationId))
    if (!r) return res.status(404).json({ error: "reservation_not_found" })
    if (r.clientId !== clientId) return res.status(403).json({ error: "forbidden" })
    if (r.status !== "reserved")
      return res.status(400).json({ error: `bad_reservation_status_${r.status}` })
  } catch (e) {
    return res.status(400).json({ error: String(e?.message ?? e) })
  }

  const releaseOnce = (reason) => {
    try {
      const cur = reservations.get(String(reservationId))
      if (cur && cur.status === "reserved") {
        setBalance(clientId, getBalance(clientId) + cur.amount)
        reservations.set(String(reservationId), {
          ...cur,
          status: "released",
          releasedAt: now(),
          releaseReason: reason,
        })
      }
    } catch {}
  }

  try {
    // ✅ 입력 프롬프트 우선순위:
    // 1) promptFront/promptBack이 오면 그대로 사용
    // 2) 없으면 prompt 하나로 fallback
    const rawFront = (promptFront ?? prompt ?? "").toString()
    const rawBack = (promptBack ?? prompt ?? "").toString()

    if (!rawFront || !rawBack) {
      releaseOnce("prompt_missing")
      return res.status(400).json({ error: "Prompt missing" })
    }

    // ✅ 성인 가드(둘 다 적용)
    const baseFront0 = withAdultGuard(rawFront)
    const baseBack0 = withAdultGuard(rawBack)

    // ✅ 충돌 제거(뷰별)
    const baseFront1 = sanitizeViewConflicts(baseFront0, "front")
    const baseBack1 = sanitizeViewConflicts(baseBack0, "back")

    // ✅ 텍스트 금지 + 헤어 일관성 소폭 강화
    const baseFront2 = enforceHairConsistency(banTextOverlays(baseFront1))
    const baseBack2 = enforceHairConsistency(banTextOverlays(baseBack1))

    // ✅ 최종 view lock
    const finalPromptFront = withViewLock(baseFront2, "front")
    const finalPromptBack = withViewLock(baseBack2, "back")

    // ✅ 순차 실행(안정)
    const frontUrl = await runImagen(finalPromptFront)
    const backUrl = await runImagen(finalPromptBack)

    if (!frontUrl || !backUrl) {
      releaseOnce("no_image_url")
      return res.status(502).json({
        error: "No imageUrl in output",
        frontUrl: frontUrl || null,
        backUrl: backUrl || null,
      })
    }

    // ✅ “앞면 2장” 최소 방어: URL 같으면 실패로 처리(환불 + 재시도 유도)
    if (frontUrl === backUrl) {
      releaseOnce("same_url_front_back")
      return res.status(502).json({
        error: "front/back identical (retry)",
        frontUrl,
        backUrl,
      })
    }

    // ✅ 성공 → commit
    reservations.set(String(reservationId), { ...r, status: "committed", committedAt: now() })

    return res.json({
      frontUrl,
      backUrl,
      usedPromptFront: finalPromptFront,
      usedPromptBack: finalPromptBack,
      aspect_ratio: "3:4",
      credit: { committed: true, balance: getBalance(clientId) },
      reservationId,
    })
  } catch (e) {
    releaseOnce("generation_failed")
    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
      reservationId,
    })
  }
})

/** -------------------------
 *  S3 Dress (FASHN)
 *  ------------------------- */
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
