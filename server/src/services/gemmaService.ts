interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: boolean;
  options: {
    temperature: number;
    num_predict: number;
  };
}

interface OllamaGenerateResponse {
  model?: string;
  created_at?: string;
  response?: string;
  done?: boolean;
}

interface OllamaTagModel {
  name: string;
  model: string;
  details?: {
    family?: string;
    families?: string[];
    parameter_size?: string;
  };
}

interface OllamaTagsResponse {
  models?: OllamaTagModel[];
}

export function getOllamaBaseUrl(): string {
  const raw = process.env.GEMMA_API_URL?.trim() || "http://127.0.0.1:11434";
  return raw
    .replace(/localhost/gi, "127.0.0.1")
    .replace(/\/api\/generate\/?$/i, "")
    .replace(/\/api\/tags\/?$/i, "")
    .replace(/\/+$/, "");
}

export function getOllamaGenerateUrl(): string {
  return `${getOllamaBaseUrl()}/api/generate`;
}

export function getOllamaTagsUrl(): string {
  return `${getOllamaBaseUrl()}/api/tags`;
}

let cachedDetectedModel: string | null = null;
let lastModelCheckTime: number = 0;

export async function detectOllamaModel(customUrl?: string): Promise<string> {
  const now = Date.now();
  if (cachedDetectedModel && now - lastModelCheckTime < 20_000) {
    return cachedDetectedModel;
  }

  const tagsUrl = customUrl
    ? `${customUrl
        .replace(/localhost/gi, "127.0.0.1")
        .replace(/\/api\/generate\/?$/, "")
        .replace(/\/api\/tags\/?$/, "")
        .replace(/\/+$/, "")}/api/tags`
    : getOllamaTagsUrl();

  const envModel = process.env.GEMMA_MODEL?.trim();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const response = await fetch(tagsUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      const data = (await response.json()) as OllamaTagsResponse;
      const models = data.models || [];
      const modelNames = models.map((m) => m.name);

      console.log(
        `[Ollama Model Discovery] Installed local models: ${modelNames.join(", ") || "none"}`,
      );

      const matchedEnv = envModel
        ? modelNames.find((m) => m === envModel || m.startsWith(envModel))
        : null;
      const gemma2b = modelNames.find(
        (m) => m.startsWith("gemma2:2b") || m === "gemma2:2b",
      );
      const gemma9b = modelNames.find(
        (m) => m.startsWith("gemma2:9b") || m === "gemma2:9b",
      );
      const anyGemma = modelNames.find((m) =>
        m.toLowerCase().includes("gemma"),
      );
      const textModel =
        modelNames.find((m) => !m.includes("embed")) || modelNames[0];

      if (matchedEnv) {
        cachedDetectedModel = matchedEnv;
      } else if (
        envModel &&
        (envModel.includes("9b") || envModel.includes("gemma"))
      ) {
        if (gemma2b) {
          console.log(
            `[Ollama Model Discovery] Preferred model "${envModel}" not installed. Auto-falling back to installed "${gemma2b}".`,
          );
          cachedDetectedModel = gemma2b;
        } else if (gemma9b) {
          console.log(
            `[Ollama Model Discovery] Preferred model "${envModel}" not installed. Auto-falling back to installed "${gemma9b}".`,
          );
          cachedDetectedModel = gemma9b;
        } else if (anyGemma) {
          console.log(
            `[Ollama Model Discovery] Preferred model "${envModel}" not installed. Auto-falling back to installed "${anyGemma}".`,
          );
          cachedDetectedModel = anyGemma;
        } else if (textModel) {
          console.warn(
            `[Ollama Model Discovery] Preferred model "${envModel}" not installed. Auto-falling back to installed "${textModel}".`,
          );
          cachedDetectedModel = textModel;
        }
      } else if (gemma2b) {
        cachedDetectedModel = gemma2b;
      } else if (gemma9b) {
        cachedDetectedModel = gemma9b;
      } else if (anyGemma) {
        cachedDetectedModel = anyGemma;
      } else if (textModel) {
        console.warn(
          `[Ollama Model Discovery] Gemma not found in local library. Auto-falling back to available model "${textModel}".`,
        );
        cachedDetectedModel = textModel;
      }

      lastModelCheckTime = now;
      if (cachedDetectedModel) {
        console.log(
          `[Ollama Model Discovery] ✓ Active generation model: "${cachedDetectedModel}"`,
        );
        return cachedDetectedModel;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Ollama Model Discovery] Could not query ${tagsUrl} (${message}). Using configured default.`,
    );
  }

  cachedDetectedModel = envModel || "gemma2:2b";
  lastModelCheckTime = now;
  return cachedDetectedModel;
}

export function getOfflineNaturalistScript(
  poiName: string,
  poiType: string = "",
  role: string = "",
  coordinate?: { lat: number; lon: number },
  environmentContext?: string,
): string {
  const coordText = coordinate
    ? ` (${coordinate.lat.toFixed(4)}, ${coordinate.lon.toFixed(4)})`
    : "";
  const env = (environmentContext || "").toLowerCase();
  const nameLower = `${poiName} ${poiType} ${role}`.toLowerCase();

  if (
    env.includes("urban") ||
    env.includes("street") ||
    env.includes("paved") ||
    env.includes("lane") ||
    nameLower.includes("marg") ||
    nameLower.includes("road") ||
    nameLower.includes("street") ||
    nameLower.includes("avenue") ||
    nameLower.includes("market") ||
    nameLower.includes("nagar")
  ) {
    return `Pavement stretches steadily beneath your stride at ${poiName}${coordText}. Cool air moves along the open corridor, carrying the muted rhythm of the avenue. Notice the shifting sunlight against roadside brick and pavement.`;
  }

  if (
    env.includes("park") ||
    env.includes("lawn") ||
    env.includes("canopy") ||
    nameLower.includes("park") ||
    nameLower.includes("garden") ||
    nameLower.includes("lawn")
  ) {
    return `Soft green turf and shaded walkways frame your path at ${poiName}${coordText}. Sunbeams filter through park tree leaves as a gentle cross-breeze sweeps across the lawn. Take a quiet breath here.`;
  }

  if (
    env.includes("water") ||
    env.includes("canal") ||
    env.includes("river") ||
    nameLower.includes("river") ||
    nameLower.includes("creek") ||
    nameLower.includes("canal")
  ) {
    return `A fresh breeze drifts off the water here at ${poiName}${coordText}. Stone embankments and ripples catch the midday light as open water cuts cleanly through the landscape. Follow the open bank forward.`;
  }

  if (
    env.includes("trail") ||
    env.includes("hill") ||
    env.includes("terrain") ||
    nameLower.includes("ridge") ||
    nameLower.includes("peak") ||
    nameLower.includes("summit") ||
    nameLower.includes("hill")
  ) {
    return `Compacted earth and stone guide your footing here at ${poiName}${coordText}. Open sky meets the hillside slope as mountain wind brushes the grass. The trail invites you steadily forward into the landscape.`;
  }

  return `You have arrived at ${poiName}${coordText}. The open air feels cool against your skin as the pathway opens ahead. Notice the steady surface beneath your stride and your immediate surroundings.`;
}

function sanitizeAIText(rawText: string): string {
  let cleaned = rawText
    .replace(/^["']|["']$/g, "")
    .replace(
      /\b(hello hiker|welcome to|as you walk|as you continue|welcome hikers|hi there|as you stand)[,!]?\s*/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  cleaned = cleaned.replace(/^#+\s*/, "").replace(/^\*\s*/, "");

  const words = cleaned.split(/\s+/).filter(Boolean);

  if (words.length > 36) {
    cleaned = words.slice(0, 34).join(" ") + ".";
  }
  return cleaned;
}

export async function generateNaturalistScript(
  poiName: string,
  poiType: string = "",
  role: string = "",
  coordinate?: { lat: number; lon: number },
  environmentContext?: string,
): Promise<string> {
  const generateUrl = getOllamaGenerateUrl();
  const modelToUse = await detectOllamaModel();

  const envDesc =
    environmentContext || "Local pathway, open neighborhood walkway";
  const coordStr = coordinate
    ? ` [lat: ${coordinate.lat.toFixed(4)}, lon: ${coordinate.lon.toFixed(4)}]`
    : "";

  const prompt = `You are a sensory audio guide narrating a walking tour in real time.
Location: "${poiName}" (type: ${poiType || "pathway"}, position: ${role || "waypoint"}${coordStr}).
Detected Environment: "${envDesc}".

STRICT RULES:
1. Length: EXACTLY 25 to 35 words. Do not exceed 35 words.
2. STRICTLY reflect the detected environment: "${envDesc}".
   - If Urban or Street: focus on pavement underfoot, ambient street sounds, brickwork, traffic rhythm, or open street breeze. DO NOT mention pine trees, forest groves, wilderness, or mountain moss.
   - If Park or Lawn: describe grass lawns, garden verges, park benches, and gentle tree shade.
   - If Waterfront: describe ripples, cooling water breeze, and stone embankments.
   - If Trail or Hill: describe earth underfoot, stone texture, open wind, and hillside views.
3. No conversational filler or greetings. NEVER start with "Hello hiker", "Welcome", or "As you walk". Jump immediately into physical sensory observations.
4. Output only the spoken script. No quotation marks or markdown.`;

  const controller = new AbortController();
  const timeoutMs = process.env.GEMMA_TIMEOUT_MS
    ? parseInt(process.env.GEMMA_TIMEOUT_MS, 10)
    : 35000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const requestBody: OllamaGenerateRequest = {
    model: modelToUse,
    prompt: prompt,
    stream: false,
    options: {
      temperature: 0.7,
      num_predict: 80,
    },
  };

  try {
    console.log(
      `[Gemma Service] Prompting model "${modelToUse}" for "${poiName}" (env: "${envDesc}")...`,
    );

    const response = await fetch(generateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      const data = (await response.json()) as OllamaGenerateResponse;
      if (data && typeof data.response === "string") {
        const cleaned = sanitizeAIText(data.response);
        const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
        console.log(
          `[Gemma Service] ✓ Generated ${wordCount} words via model "${modelToUse}".`,
        );
        if (wordCount >= 20) {
          return cleaned;
        }
      }
    } else {
      const errText = await response.text();
      console.error(
        ` Gemma Generation Failed (HTTP ${response.status}): ${errText}`,
      );
    }
  } catch (err: unknown) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    console.error(` Gemma Generation Failed: ${message}`);
    console.warn(
      `[Gemma Service] Dropping into dynamic context-aware fallback for "${poiName}".`,
    );
  }

  return getOfflineNaturalistScript(
    poiName,
    poiType,
    role,
    coordinate,
    envDesc,
  );
}

export { generateNaturalistScript as generateAudioScript };
