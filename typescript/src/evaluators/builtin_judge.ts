import { ObservedStep, EvalResult, registerAdapter } from "./builtin";

// ── Built-in LLM Judge ──
//
// Vendor-neutral. Detects available provider from env vars:
//   OPENAI_API_KEY     → GPT-4o
//   ANTHROPIC_API_KEY  → Claude Sonnet
//   GEMINI_API_KEY     → Gemini Flash
//
// Set ABS_JUDGE_PROVIDER to pick one explicitly.
// Falls back with a helpful message if no key is found.

const JUDGE_SYSTEM = `You are an expert evaluator of AI assistant responses.
Score the response on a scale of 0.0 to 1.0 based on the given criteria.
Be strict but fair. Respond in this format:

Score: <number between 0.0 and 1.0>
Reason: <one sentence explaining the score>`;

function buildPrompt(trace: ObservedStep[], criteria: string): string {
  const traceText = trace
    .map(
      (s) =>
        `[${s.actor}] ${s.action}${s.target ? " → " + s.target : ""}: ${
          typeof s.content === "string" ? s.content : JSON.stringify(s.content)
        }`
    )
    .join("\n");
  return `Given this conversation:\n\n${traceText}\n\nEvaluate: ${criteria}`;
}

// ── Provider detection ──

function detectProvider(): string | null {
  const explicit = (process.env.ABS_JUDGE_PROVIDER || "").toLowerCase();
  if (explicit === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (explicit === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (explicit === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  // Auto-detect
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

// ── OpenAI judge ──

async function judgeOpenAI(trace: ObservedStep[], criteria: string): Promise<EvalResult> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const model = process.env.ABS_JUDGE_MODEL || "gpt-4o";

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: buildPrompt(trace, criteria) },
      ],
      temperature: 0,
      max_tokens: 512,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI returned ${resp.status}: ${text.substring(0, 200)}`);
  }

  const data = await resp.json() as any;
  const content = data.choices[0].message.content;
  return parseJudgeResponse(content, "openai");
}

// ── Anthropic judge ──

async function judgeAnthropic(trace: ObservedStep[], criteria: string): Promise<EvalResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const model = process.env.ABS_JUDGE_MODEL || "claude-sonnet-4-20250514";

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: buildPrompt(trace, criteria) }],
      max_tokens: 512,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic returned ${resp.status}: ${text.substring(0, 200)}`);
  }

  const data = await resp.json() as any;
  const content = data.content[0].text;
  return parseJudgeResponse(content, "anthropic");
}

// ── Gemini judge ──

async function judgeGemini(trace: ObservedStep[], criteria: string): Promise<EvalResult> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const model = process.env.ABS_JUDGE_MODEL || "gemini-2.0-flash";

  const fullPrompt = `${JUDGE_SYSTEM}\n\n${buildPrompt(trace, criteria)}`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { maxOutputTokens: 512 },
      }),
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini returned ${resp.status}: ${text.substring(0, 200)}`);
  }

  const data = await resp.json() as any;
  const content = data.candidates[0].content.parts[0].text;
  return parseJudgeResponse(content, "gemini");
}

// ── Response parser ──

function parseJudgeResponse(content: string, provider: string): EvalResult {
  let score = 0.5;
  let reason = content.substring(0, 200);

  const scoreMatch = content.match(/Score:\s*(0?\.?\d+|[01](?:\.\d+)?)/i);
  if (scoreMatch) {
    score = Math.max(0, Math.min(1, parseFloat(scoreMatch[1]) || 0.5));
  }

  const reasonMatch = content.match(/Reason:\s*(.+?)(?:\n|$)/i);
  if (reasonMatch) {
    reason = reasonMatch[1].trim().substring(0, 200);
  }

  return {
    type: "llm_judge",
    passed: score >= 0.7,
    score,
    reason: `[${provider}] ${reason}`,
  };
}

// ── Mock judge (demos/testing, no API key needed) ──

function mockJudge(trace: ObservedStep[], evaluation: any): EvalResult {
  const criteria = evaluation.criteria || "";
  let lastContent = "";
  for (let i = trace.length - 1; i >= 0; i--) {
    if (trace[i].actor === "assistant" && trace[i].content) {
      lastContent = String(trace[i].content);
      break;
    }
  }

  let score = 0.85;
  if (!lastContent) score = 0.3;
  else if (lastContent.length < 10) score = 0.4;

  return {
    type: "llm_judge",
    passed: score >= 0.7,
    score,
    reason:
      `[mock] Response seems ${score >= 0.7 ? "good" : "weak"} ` +
      `(content length: ${lastContent.length} chars). ` +
      `Criteria: ${criteria.substring(0, 80)}`,
  };
}

// ── Main adapter ──

async function builtinLlmJudge(
  trace: ObservedStep[],
  evaluation: any
): Promise<EvalResult> {
  const provider = detectProvider();

  if (!provider) {
    // Mock judge for demos/testing — no API key needed
    if (["1", "true", "yes"].includes((process.env.ABS_MOCK_JUDGE || "").toLowerCase())) {
      return mockJudge(trace, evaluation);
    }
    return {
      type: "llm_judge",
      passed: false,
      score: 0,
      reason:
        "No LLM provider available. Set one of:\n" +
        "  OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY\n" +
        "For demos without API keys: ABS_MOCK_JUDGE=true",
    };
  }

  const criteria = evaluation.criteria || "Is the response helpful and accurate?";

  try {
    switch (provider) {
      case "openai":
        return await judgeOpenAI(trace, criteria);
      case "anthropic":
        return await judgeAnthropic(trace, criteria);
      case "gemini":
        return await judgeGemini(trace, criteria);
      default:
        return { type: "llm_judge", passed: false, score: 0, reason: `Unknown provider: ${provider}` };
    }
  } catch (err: any) {
    return {
      type: "llm_judge",
      passed: false,
      score: 0,
      reason: `Judge error (${provider}): ${err.message}`,
    };
  }
}

// Register built-in judge as default
registerAdapter("llm_judge", builtinLlmJudge);
registerAdapter("g_eval", builtinLlmJudge);
registerAdapter("faithfulness", builtinLlmJudge);
