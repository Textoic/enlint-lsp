export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompletionRequest = {
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature?: number;
  signal?: AbortSignal;
};

export type Completion = {
  content: string;
  truncated: boolean;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type Complete = (request: CompletionRequest) => Promise<Completion>;

export type OllamaSettings = {
  kind: "ollama";
  model: string;
  baseUrl?: string;
};

export type OpenRouterSettings = {
  kind: "openrouter";
  model: string;
  apiKey: string;
  baseUrl?: string;
};

export type ProviderSettings = OllamaSettings | OpenRouterSettings;

export type Fetch = typeof fetch;

export class ProviderError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export const defaultOllamaUrl = "http://127.0.0.1:11434";
export const defaultOpenRouterUrl = "https://openrouter.ai/api/v1";

const withoutReasoning = (content: string) =>
  content.replace(/<think>[\s\S]*?<\/think>/giu, "").trim();

const hostOf = (url: string) => new URL(url).host;

const isAbort = (cause: unknown) =>
  cause instanceof Error && cause.name === "AbortError";

const unreachable = (url: string) => (cause: unknown) => {
  if (isAbort(cause)) {
    throw cause;
  }

  throw new ProviderError(`Cannot reach ${hostOf(url)}.`);
};

const checked = async (url: string, response: Response) => {
  if (!response.ok) {
    throw new ProviderError(
      `${hostOf(url)} answered ${response.status}: ${await response.text()}`,
      response.status === 401 ? 401 : 502,
    );
  }

  return response.json() as Promise<unknown>;
};

type Post = {
  body: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

const postJson = async (
  fetchFn: Fetch,
  url: string,
  { body, headers, signal }: Post,
) =>
  checked(
    url,
    await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    }).catch(unreachable(url)),
  );

const getJson = async (fetchFn: Fetch, url: string) =>
  checked(
    url,
    await fetchFn(url, { headers: { accept: "application/json" } }).catch(
      unreachable(url),
    ),
  );

type OllamaAnswer = {
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

const ollamaCompletion =
  ({ model, baseUrl = defaultOllamaUrl }: OllamaSettings, fetchFn: Fetch) =>
  async (request: CompletionRequest): Promise<Completion> => {
    const answer = (await postJson(fetchFn, `${baseUrl}/api/chat`, {
      signal: request.signal,
      body: {
        model,
        messages: request.messages,
        stream: false,
        think: false,
        options: {
          temperature: request.temperature ?? 0.3,
          num_predict: request.maxOutputTokens,
        },
      },
    })) as OllamaAnswer;
    return {
      content: withoutReasoning(answer.message?.content ?? ""),
      truncated: answer.done_reason === "length",
      costUsd: 0,
      inputTokens: answer.prompt_eval_count,
      outputTokens: answer.eval_count,
    };
  };

type OpenRouterAnswer = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
  error?: { message?: string };
};

const openRouterHeaders = (apiKey: string) => ({
  authorization: `Bearer ${apiKey}`,
  "HTTP-Referer": "https://textoic.com",
  "X-Title": "Textoic",
});

const usageOf = ({ usage = {} }: OpenRouterAnswer) => ({
  costUsd: usage.cost,
  inputTokens: usage.prompt_tokens,
  outputTokens: usage.completion_tokens,
});

const fromOpenRouter = (answer: OpenRouterAnswer): Completion => {
  if (answer.error?.message != null) {
    throw new ProviderError(`OpenRouter: ${answer.error.message}`);
  }

  const [choice] = answer.choices ?? [];
  return {
    content: withoutReasoning(choice?.message?.content ?? ""),
    truncated: choice?.finish_reason === "length",
    ...usageOf(answer),
  };
};

const openRouterCompletion =
  (
    { model, apiKey, baseUrl = defaultOpenRouterUrl }: OpenRouterSettings,
    fetchFn: Fetch,
  ) =>
  async (request: CompletionRequest): Promise<Completion> =>
    fromOpenRouter(
      (await postJson(fetchFn, `${baseUrl}/chat/completions`, {
        signal: request.signal,
        headers: openRouterHeaders(apiKey),
        body: {
          model,
          messages: request.messages,
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature ?? 0.3,
          usage: { include: true },
        },
      })) as OpenRouterAnswer,
    );

const lacksKey = (settings: ProviderSettings) =>
  settings.kind === "openrouter" && settings.apiKey.trim() === "";

export const completionFor = (
  settings: ProviderSettings,
  fetchFn: Fetch = fetch,
): Complete => {
  if (lacksKey(settings)) {
    throw new ProviderError("OpenRouter needs an API key.", 400);
  }

  return settings.kind === "ollama"
    ? ollamaCompletion(settings, fetchFn)
    : openRouterCompletion(settings, fetchFn);
};

type OllamaTags = { models?: { name: string }[] };
type OpenRouterModels = { data?: { id: string }[] };

const ollamaModels = async (baseUrl: string, fetchFn: Fetch) => {
  const tags = (await getJson(fetchFn, `${baseUrl}/api/tags`)) as OllamaTags;
  return (tags.models ?? []).map(({ name }) => name).sort();
};

const openRouterModels = async (baseUrl: string, fetchFn: Fetch) => {
  const models = (await getJson(
    fetchFn,
    `${baseUrl}/models`,
  )) as OpenRouterModels;
  return (models.data ?? []).map(({ id }) => id).sort();
};

export const listModels = async (
  { kind, baseUrl }: { kind: ProviderSettings["kind"]; baseUrl?: string },
  fetchFn: Fetch = fetch,
): Promise<string[]> =>
  kind === "ollama"
    ? ollamaModels(baseUrl ?? defaultOllamaUrl, fetchFn)
    : openRouterModels(baseUrl ?? defaultOpenRouterUrl, fetchFn);
