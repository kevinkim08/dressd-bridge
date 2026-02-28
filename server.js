import express from "express"
import cors from "cors"

const app = express()

// ✅ 개발 단계: CORS 전면 허용
app.use(cors())
app.options("*", cors())

// ✅ 핵심: base64 이미지 받으려면 limit 크게
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))

app.get("/", (req, res) => {
  res.send("DRESSD server running")
})

app.get("/health", (req, res) => {
  res.json({ ok: true })
})

// ✅ dress endpoint 확인용 GET
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

/**
 * ✅ TEST MODE: 합성 대신 "model_single" 그대로 반환
 * 요청 payload가 정상으로 들어오는지만 확인하는 목적
 */
app.post("/api/dress", async (req, res) => {
  try {
    const body = req.body || {}
    const view = body.view || "front"
    const storeId = body.storeId || "no-storeId"
    const files = body.files || body.dressFiles || {}

    // files 안에 model_single이 있어야 함
    const model = files["model_single"]

    // ✅ 서버에서 로그로 확인( Render Logs 에 찍힘 )
    console.log("[/api/dress] storeId:", storeId, "view:", view)
    console.log("[/api/dress] keys:", Object.keys(files || {}).slice(0, 30))
    console.log(
      "[/api/dress] model_single bytes:",
      typeof model === "string" ? model.length : 0
    )

    if (!model || typeof model !== "string") {
      return res.status(400).json({
        ok: false,
        error: "model_single missing in files",
        gotKeys: Object.keys(files || {}),
      })
    }

    // ✅ 일단 결과를 model 그대로 반환 (Viewer가 즉시 뜨는지 확인)
    return res.json({
      ok: true,
      mode: "TEST_ECHO_MODEL",
      view,
      storeId,
      imageDataUrl: model, // 프론트가 이 키를 읽어서 Viewer에 넣게 만들면 됨
    })
  } catch (e) {
    console.error("[/api/dress] ERROR:", e)
    return res.status(500).json({
      ok: false,
      error: "Internal Server Error",
      detail: String(e?.message ?? e),
    })
  }
})

// ✅ 예외가 HTML로 떨어지는 것 방지(항상 JSON)
app.use((err, req, res, next) => {
  console.error("[global error]", err)
  res.status(500).json({
    ok: false,
    error: "Unhandled error",
    detail: String(err?.message ?? err),
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
