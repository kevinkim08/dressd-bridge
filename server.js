import express from "express";
import cors from "cors";
import Replicate from "replicate";

const app = express();

app.use(cors());
app.use(express.json());

// Render/health check
app.get("/", (req, res) => {
  res.send("DRESSD server running");
});

// Replicate client (token은 Render Env: REPLICATE_API_TOKEN)
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// ---------- 핵심: S1 API ----------
app.post("/api/s1", async (req, res) => {
  const { prompt } = req.body;

  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({ error: "Missing REPLICATE_API_TOKEN in env" });
  }

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Prompt missing" });
  }

  try {
    // ✅ Replicate 공식 방식: replicate.run(model, { input })
    const input = {
      prompt,
      // 필요하면 여기 옵션 추가 (모델 스키마에 맞춰야 함)
      // aspect_ratio: "16:9",
      // safety_filter_level: "block_medium_and_above",
    };

    const output = await replicate.run("google/imagen-4", { input });

    // 출력 형태는 모델마다 다를 수 있어서 안전하게 처리
    let imageUrl = null;

    // output이 배열이면 첫 번째가 URL인 경우가 많음
    if (Array.isArray(output)) {
      imageUrl = output[0] ?? null;
    } else if (typeof output === "string") {
      imageUrl = output;
    } else if (output && typeof output === "object") {
      // 일부 모델은 { url(): ... } 형태 or { output: ... } 형태가 있을 수 있음
      if (typeof output.url === "function") imageUrl = output.url();
      else if (typeof output.url === "string") imageUrl = output.url;
      else if (Array.isArray(output.output)) imageUrl = output.output[0] ?? null;
      else if (typeof output.output === "string") imageUrl = output.output;
    }

    // ✅ safety block / 실패 케이스: imageUrl이 없으면 원인도 같이 내려주기
    if (!imageUrl) {
      return res.status(200).json({
        ok: true,
        imageUrl: null,
        note: "No imageUrl in output (maybe blocked/failed). Check server logs.",
        replicateOutput: output,
      });
    }

    return res.json({ ok: true, imageUrl });
  } catch (err) {
    // Replicate 에러는 status / retry_after 같은 값이 붙는 경우가 있음
    const status = err?.status || err?.response?.status;

    // 429 Rate limit이면 retry_after 힌트 전달
    if (status === 429) {
      const retryAfter = err?.retry_after || err?.response?.headers?.get?.("retry-after") || null;
      if (retryAfter) res.setHeader("Retry-After", String(retryAfter));

      return res.status(429).json({
        error: "Rate limited by Replicate",
        retryAfter,
        detail: err?.detail || err?.message || String(err),
      });
    }

    return res.status(500).json({
      error: "Generation failed",
      detail: err?.detail || err?.message || String(err),
    });
  }
});

// ---------- 브라우저 테스트 페이지 ----------
app.get("/test", async (req, res) => {
  const prompt = (req.query.prompt || "").toString();

  if (!prompt) {
    return res.status(200).send(`
      <h2>Test</h2>
      <p>Use: <code>/test?prompt=adult%20female%20fashion%20model%20age%2025</code></p>
    `);
  }

  try {
    // 서버 내부에서 /api/s1 로직 재사용 (직접 호출)
    const input = {
      prompt,
      // safety_filter_level: "block_medium_and_above",
    };

    const output = await replicate.run("google/imagen-4", { input });

    let imageUrl = null;
    if (Array.isArray(output)) imageUrl = output[0] ?? null;
    else if (typeof output === "string") imageUrl = output;
    else if (output && typeof output === "object") {
      if (typeof output.url === "function") imageUrl = output.url();
      else if (typeof output.url === "string") imageUrl = output.url;
      else if (Array.isArray(output.output)) imageUrl = output.output[0] ?? null;
      else if (typeof output.output === "string") imageUrl = output.output;
    }

    const escapedPrompt = prompt.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

    if (!imageUrl) {
      return res.status(200).send(`
        <div style="font-family:Arial; padding:16px;">
          <h2 style="color:#d33;">성공 응답인데 imageUrl이 없어</h2>
          <b>Prompt:</b> ${escapedPrompt}<br/><br/>
          <pre style="background:#f6f6f6; padding:12px; overflow:auto;">${JSON.stringify(output, null, 2)}</pre>
        </div>
      `);
    }

    return res.status(200).send(`
      <div style="font-family:Arial; padding:16px;">
        <h2 style="color:green;">✅ 이미지 생성 성공</h2>
        <b>Prompt:</b> ${escapedPrompt}<br/><br/>
        <img src="${imageUrl}" style="max-width:512px; border:1px solid #ddd;" />
        <p><a href="${imageUrl}" target="_blank">Open image</a></p>
      </div>
    `);
  } catch (err) {
    const escapedPrompt = prompt.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return res.status(200).send(`
      <div style="font-family:Arial; padding:16px;">
        <h2 style="color:#d33;">❌ 생성 실패</h2>
        <b>Prompt:</b> ${escapedPrompt}<br/><br/>
        <pre style="background:#f6f6f6; padding:12px; overflow:auto;">${JSON.stringify({
          status: err?.status,
          detail: err?.detail,
          message: err?.message,
        }, null, 2)}</pre>
      </div>
    `);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));
