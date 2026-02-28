// server.js
import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ✅ CORS: 일단 전체 허용(테스트용)
 * - 배포 후 정상 동작 확인되면, 다시 allowlist 방식으로 좁히자.
 */
app.use(
  cors({
    origin: true, // 요청 Origin을 그대로 허용
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
)

// ✅ preflight 안정화
app.options("*", cors())

/**
 * ✅ JSON 바디 사이즈 크게 (dataUrl 커서 기본값이면 터질 수 있음)
 */
app.use(express.json({ limit: "25mb" }))

app.get("/", (req, res) => {
  res.send("DRESSD server running")
})

app.get("/health", (req, res) => {
  res.json({ ok: true })
})

/**
 * =========================================================
 * ✅ Replicate (S1 전용)
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
  if (!prompt) {
    return res.status(400).json({ error: "Prompt missing" })
  }

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
 * ✅ S3 Dress endpoint (연결/디버그용: model echo)
 * =========================================================
 */
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

app.post("/api/dress", async (req, res) => {
  try {
    const body = req.body || {}
    const view = body.view || "front"
    const storeId = body.storeId || "no-storeId"

    const files =
      body.files ||
      body.dressFiles ||
      body.payload?.files ||
      body.payload?.dressFiles ||
      {}

    console.log("[/api/dress] storeId:", storeId, "view:", view)
    console.log("[/api/dress] body keys:", Object.keys(body))
    console.log(
      "[/api/dress] files keys:",
      Object.keys(files || {}).slice(0, 80)
    )

    const model =
      files["model_single"] ||
      files["model"] ||
      files["model_front"] ||
      body.model_single ||
      body.model ||
      body.payload?.model_single ||
      body.payload?.model

    if (!model || typeof model !== "string") {
      return res.status(400).json({
        ok: false,
        error: "model missing",
        hint: "Expected model_single in files (or compatible key).",
        gotBodyKeys: Object.keys(body),
        gotFilesKeys: Object.keys(files || {}),
      })
    }

    // ✅ 일단 model을 그대로 echo (연결/뷰어 반응 확인용)
    return res.json({
      ok: true,
      mode: "TEST_ECHO_MODEL",
      view,
      storeId,
      gotBodyKeys: Object.keys(body),
      gotFilesKeys: Object.keys(files || {}),
      imageDataUrl: model,
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
