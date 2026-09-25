/**
 * 9Router wire request format (OpenAI-compatible)
 */
export interface NineRouterWireRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string | unknown;
    name?: string | undefined;
  }>;
  temperature?: number | undefined;
  top_p?: number | undefined;
  max_tokens?: number | undefined;
  stream?: boolean | undefined;
  stop?: string | string[] | undefined;
  presence_penalty?: number | undefined;
  frequency_penalty?: number | undefined;
  user?: string | undefined;
  tools?: unknown[] | undefined;
  tool_choice?: unknown | undefined;
  response_format?: unknown | undefined;
}

/**
 * 9Router wire response format (OpenAI-compatible)
 */
export interface NineRouterWireChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: unknown[] | undefined;
  };
  finish_reason?: string | null | undefined;
}

export interface NineRouterWireUsage {
  prompt_tokens?: number | undefined;
  completion_tokens?: number | undefined;
  total_tokens?: number | undefined;
}

export interface NineRouterWireResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: NineRouterWireChoice[];
  usage?: NineRouterWireUsage | undefined;
  error?:
    | {
        message?: string | undefined;
        type?: string | undefined;
        code?: string | undefined;
      }
    | undefined;
}

/**
 * 9Router wire streaming chunk format
 */
export interface NineRouterWireStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string | undefined;
      content?: string | null | undefined;
      tool_calls?: unknown[] | undefined;
    };
    finish_reason?: string | null | undefined;
  }>;
}

/**
 * 9Router model list wire response
 */
export interface NineRouterWireModel {
  id: string;
  object: string;
  created?: number | undefined;
  owned_by?: string | undefined;
  context_length?: number | undefined;
  supports_chat?: boolean | undefined;
  supports_streaming?: boolean | undefined;
}

export interface NineRouterWireModelList {
  object: string;
  data: NineRouterWireModel[];
}
