// server.js
import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
)
app.options("*", cors())

app.use(express.json({ limit: "35mb" }))

app.get("/", (req, res) => res.send("DRESSD server running"))
app.get("/health", (req, res) => res.json({ ok: true }))

/**
 * =========================================================
 * ✅ Replicate (S1)
 * =========================================================
 */
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

function withAdultGuard(prompt) {
  return `adult, age 25, ${prompt}`
}

app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body

  if (!process.env.REPLICATE_API_TOKEN) {
    return res
      .status(500)
      .json({ error: "REPLICATE_API_TOKEN missing on server" })
  }
  if (!prompt) return res.status(400).json({ error: "Prompt missing" })

  try {
    const finalPrompt = withAdultGuard(prompt)

    const output = await replicate.run("google/imagen-4", {
      input: {
        prompt: finalPrompt,
        image_size: "2K",
        aspect_ratio: "9:16",
        output_format: "png",
      },
    })

    const imageUrl = Array.isArray(output)
      ? output[0]?.url
        ? output[0].url()
        : output[0]
      : output?.url
        ? output.url()
        : output

    if (!imageUrl) {
      return res.status(502).json({
        error: "No imageUrl in output (possibly blocked/failed).",
        output,
      })
    }

    return res.json({ imageUrl, usedPrompt: finalPrompt })
  } catch (e) {
    return res.status(500).json({
      error: "Generation failed",
      detail: String(e?.message ?? e),
    })
  }
})

/**
 * =========================================================
 * ✅ S3 Dress endpoint (연결/디버그: model echo)
 * =========================================================
 */
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

/**
 * ✅ 어떤 형태로 와도 dataUrl을 최대한 찾아냄
 * - string: 그대로
 * - array: 첫 원소부터 재귀적으로 탐색
 * - object: 흔한 키들(dataUrl/previewUrl/imageDataUrl/src/url/...)
 *          + model_single 같은 키로 직접 박혀있는 경우
 *          + 숫자키("0","1") array-like 도 대응
 *          + 한 단계 더 들어간 nested 도 대응 (image: {...}, model: {...} 등)
 */
function pickDataUrl(x, depth = 0) {
  if (!x) return ""
  if (depth > 4) return "" // 무한 루프 방지

  if (typeof x === "string") return x

  // Array
  if (Array.isArray(x)) {
    for (const item of x) {
      const got = pickDataUrl(item, depth + 1)
      if (got) return got
    }
    return ""
  }

  // Object
  if (typeof x === "object") {
    // 1) 흔한 키들 우선
    const directKeys = [
      "dataUrl",
      "imageDataUrl",
      "previewUrl",
      "src",
      "url",
      "image",
      "base64",
      "b64",
      "content",
    ]
    for (const k of directKeys) {
      if (typeof x[k] === "string" && x[k].startsWith("data:image")) return x[k]
    }

    // 2) model_single 처럼 키로 바로 들어오는 경우
    if (typeof x["model_single"] === "string" && x["model_single"].startsWith("data:image")) {
      return x["model_single"]
    }

    // 3) 숫자키 array-like ({"0": "...", "1": "..."})
    if (typeof x["0"] === "string" && x["0"].startsWith("data:image")) return x["0"]

    // 4) 위 키들이 객체라면 한 단계 더 들어가 보기
    for (const k of directKeys) {
      if (x[k] && typeof x[k] === "object") {
        const got = pickDataUrl(x[k], depth + 1)
        if (got) return got
      }
    }

    // 5) 마지막: 모든 값 훑어서 dataUrl 찾기 (너무 무겁지 않게 depth 제한 있음)
    for (const k of Object.keys(x)) {
      const v = x[k]
      const got = pickDataUrl(v, depth + 1)
      if (got) return got
    }
  }

  return ""
}

function keysOf(x) {
  if (!x) return []
  if (Array.isArray(x)) return x.map((_, i) => String(i))
  if (typeof x === "object") return Object.keys(x)
  return []
}

app.post("/api/dress", async (req, res) => {
  try {
    const body = req.body || {}
    const view = body.view || "front"
    const storeId = body.storeId || "no-storeId"

    const modelDataUrl = pickDataUrl(body.model)

    // garments: object일 수도, array일 수도 있음
    const garmentsRaw = body.garments
    const garmentsKeys = keysOf(garmentsRaw)

    console.log("[/api/dress] storeId:", storeId, "view:", view)
    console.log("[/api/dress] body keys:", Object.keys(body))
    console.log("[/api/dress] model keys:", keysOf(body.model))
    console.log("[/api/dress] garments keys:", garmentsKeys.slice(0, 60))
    console.log("[/api/dress] modelDataUrl length:", modelDataUrl?.length || 0)

    if (!modelDataUrl) {
      return res.status(400).json({
        ok: false,
        error: "model missing",
        hint: "Expected body.model as dataUrl string OR object containing dataUrl-like fields.",
        gotBodyKeys: Object.keys(body),
        gotModelType: typeof body.model,
        gotModelKeys: keysOf(body.model),
        gotGarmentsKeys: garmentsKeys,
      })
    }

    // ✅ 1차 목표: 연결 검증 → model을 그대로 반환
    return res.json({
      ok: true,
      mode: "TEST_ECHO_MODEL",
      view,
      storeId,
      gotBodyKeys: Object.keys(body),
      gotModelKeys: keysOf(body.model),
      gotGarmentsKeys: garmentsKeys,
      imageDataUrl: modelDataUrl,
    })
  } catch (e) {
    console.error("[/api/dress] error:", e)
    return res.status(500).json({
      ok: false,
      error: "Internal error in /api/dress",
      detail: String(e?.message ?? e),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
