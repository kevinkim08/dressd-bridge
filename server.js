// server.js (FULL)
// Node ESM 기준: package.json에 "type": "module" 권장

import express from "express"
import cors from "cors"
import Replicate from "replicate"

const app = express()

/**
 * ✅ Render/Framer 환경에서 "Failed to fetch" 가장 흔한 원인: CORS
 * - framer.app / framer.com / localhost는 기본 허용
 * - 그 외에도 프리뷰/커스텀 도메인에서 origin이 다르게 찍히는 경우가 많아서
 *   "origin이 있는 경우엔 일단 허용" 옵션을 안전하게 둠 (개발 단계)
 *
 * 운영 단계에서는 allowlist로 좁히는 걸 추천.
 */
const corsOptions = {
  origin: (origin, cb) => {
    // origin 없는 경우(서버-서버/헬스체크) 허용
    if (!origin) return cb(null, true)

    const o = String(origin)

    const ok =
      o.includes("framer.app") ||
      o.includes("framer.com") ||
      o.includes("localhost") ||
      o.includes("127.0.0.1") ||
      o.includes("onrender.com")

    // ✅ 개발 단계: 위 조건 외도 허용(프리뷰/커스텀 도메인 이슈 방지)
    // 운영에서 막고 싶으면 아래 줄을: return cb(new Error(...))로 바꾸면 됨.
    if (ok) return cb(null, true)
    return cb(null, true)
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}

app.use(cors(corsOptions))
app.options("*", cors(corsOptions))

/**
 * ✅ base64(dataUrl) 업로드는 바디가 큼
 * 기본 100kb 제한이면 바로 터짐.
 */
app.use(express.json({ limit: "50mb" }))

app.get("/", (req, res) => {
  res.send("DRESSD server running")
})

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

/**
 * ✅ /api/dress GET: 브라우저에서 찍어볼 때 안내용
 */
app.get("/api/dress", (req, res) => {
  res.json({ ok: true, hint: "Use POST /api/dress" })
})

/**
 * ✅ replicate는 “나중에” 붙여도 되고,
 * 지금은 우선 서버-프론트 연결/요청 스키마를 안정화하는 게 1순위.
 */
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
})

/**
 * ✅ dataUrl 또는 {dataUrl} 형태를 모두 허용
 */
function normalizeDataUrl(x) {
  if (!x) return ""
  if (typeof x === "string") return x
  if (typeof x === "object" && typeof x.dataUrl === "string") return x.dataUrl
  return ""
}

/**
 * ✅ garments는 object 또는 array 형태가 들어올 수 있으니 둘 다 처리
 * - object: { top_front: "data:image/...", top_back: "..." }
 * - array:  [{ key:"top_front", dataUrl:"..." }, ...]
 */
function normalizeGarments(garments) {
  const out = {}
  if (!garments) return out

  if (Array.isArray(garments)) {
    for (const g of garments) {
      if (!g) continue
      const k = String(g.key ?? "")
      const v = normalizeDataUrl(g.dataUrl ?? g)
      if (k && v) out[k] = v
    }
    return out
  }

  if (typeof garments === "object") {
    for (const [k, v] of Object.entries(garments)) {
      const dv = normalizeDataUrl(v)
      if (dv) out[String(k)] = dv
    }
    return out
  }

  return out
}

/**
 * ✅ POST /api/dress
 * 요청 예:
 * {
 *   view: "front" | "back",
 *   model: "data:image/...",
 *   garments: { "top_front": "data:image/...", ... },
 *   clientTime, storeId
 * }
 */
app.post("/api/dress", async (req, res) => {
  try {
    const { view, model, garments, clientTime, storeId } = req.body ?? {}

    const v = view === "back" ? "back" : "front"
    const modelDataUrl = normalizeDataUrl(model)
    const gmap = normalizeGarments(garments)

    const garmentKeys = Object.keys(gmap)

    // ✅ 스키마 검증 (프론트 디버깅을 위해 "왜 실패했는지"를 친절하게 내려줌)
    if (!modelDataUrl) {
      return res.status(400).json({
        ok: false,
        error: "model missing",
        hint: "Expected body.model as dataUrl string OR {dataUrl}",
        gotBodyKeys: Object.keys(req.body ?? {}),
        gotModelType: typeof model,
        gotGarmentsKeys: garmentKeys,
      })
    }

    // ✅ 지금 단계에서는 garment가 없어도 통과(모델만 넣고도 연결 테스트 가능)
    // garment 0개면 그냥 모델을 그대로 반환해서 viewer에 뜨는지 확인 가능
    // 나중에 “최소 1개 garment 필수”로 바꿀 수 있음.
    // if (garmentKeys.length === 0) { ... }

    /**
     * ✅ 1단계 목표:
     * - 서버가 요청을 받는다
     * - 프론트가 응답을 받는다
     * - Viewer가 즉시 업데이트 된다
     *
     * 그래서 "일단은" 결과를 model 그대로 내려준다(에코).
     * 다음 단계에서 replicate 가상피팅 모델로 교체하면 됨.
     */
    const imageDataUrl = modelDataUrl

    return res.json({
      ok: true,
      view: v,
      imageDataUrl, // ✅ 프론트가 기대하는 키
      debug: {
        storeId: storeId ?? null,
        clientTime: clientTime ?? null,
        garmentKeys,
        garmentsCount: garmentKeys.length,
        modelBytes: modelDataUrl.length,
      },
    })
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Internal Server Error",
      detail: String(e?.message ?? e),
    })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on", PORT))
