import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("DRESSD server running");
});

/**
 * ✅ 테스트 페이지
 * - 브라우저에서: https://dressd-bridge.onrender.com/test?prompt=fashion%20model
 * - 화면에서 이미지 나오면 성공
 */
app.get("/test", async (req, res) => {
  const prompt = (req.query.prompt || "").toString();

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>DRESSD S1 Test</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; }
    .ok { color: #0a7d00; font-weight: 700; }
    .bad { color: #b00020; font-weight: 700; }
    img { max-width: 512px; display:block; margin-top: 16px; border: 1px solid #eee; }
    pre { background:#f6f6f6; padding:12px; overflow:auto; }
  </style>
</head>
<body>
  <div id="status">로딩중...</div>
  <div><b>Prompt:</b> ${escapeHtml(prompt)}</div>
  <img id="img" />
  <pre id="json"></pre>

  <script>
    async function run() {
      const prompt = ${JSON.stringify(prompt)};
      if (!prompt) {
        document.getElementById("status").innerHTML = '<span class="bad">prompt가 비어있어</span>';
        return;
      }

      const r = await fetch("/api/s1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });

      const data = await r.json().catch(() => ({}));
      document.getElementById("json").textContent = JSON.stringify({ httpStatus: r.status, ...data }, null, 2);

      if (!r.ok) {
        document.getElementById("status").innerHTML = '<span class="bad">실패</span>';
        return;
      }

      if (!data.imageUrl) {
        document.getElementById("status").innerHTML = '<span class="bad">성공 응답인데 imageUrl이 없어</span>';
        return;
      }

      document.getElementById("status").innerHTML = '<span class="ok">이미지 생성 성공</span>';
      document.getElementById("img").src = data.imageUrl;
    }

    run();
  </script>
</body>
</html>
  `);
});

// HTML escape helper
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * ✅ S1 생성 API
 * - 올바른 Replicate 엔드포인트 사용
 * - 오류/레이트리밋/출력 null 케이스까지 프론트가 확인 가능하게 응답을 정리
 */
app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body || {};
  const token = process.env.REPLICATE_API_TOKEN;

  if (!token) {
    return res.status(500).json({ error: "REPLICATE_API_TOKEN is missing on server" });
  }
  if (!prompt) {
    return res.status(400).json({ error: "Prompt missing" });
  }

  try {
    // ✅ 핵심: /v1/models/{owner}/{name}/predictions
    const response = await fetch(
      "https://api.replicate.com/v1/models/google/imagen-4/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "wait"
        },
        body: JSON.stringify({
          input: { prompt }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    // 레이트리밋/에러면 그대로 내려서 테스트 화면에서 확인 가능하게
    if (!response.ok) {
      return res.status(response.status).json({
        error: "Replicate request failed",
        replicate: data
      });
    }

    // output 파싱
    const out = data?.output;
    const imageUrl = Array.isArray(out) ? out[0] : out;

    // ✅ output이 null일 수도 있음 (차단/실패/예외)
    // 이 경우 raw 데이터 같이 내려서 원인 파악 가능하게
    if (!imageUrl) {
      return res.status(200).json({
        ok: true,
        imageUrl: null,
        note: "No imageUrl in output (maybe blocked/failed). Check replicate payload.",
        replicate: data
      });
    }

    return res.json({ ok: true, imageUrl });

  } catch (error) {
    return res.status(500).json({
      error: "Generation failed (server exception)",
      detail: String(error?.message || error)
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running");
});
