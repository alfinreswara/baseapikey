export const API_KEY_PERMISSIONS = {
  CHAT_COMPLETIONS: 'chat:completions',
  EMBEDDINGS_CREATE: 'embeddings:create',
  IMAGES_GENERATE: 'images:generate',
  AUDIO_TRANSCRIBE: 'audio:transcribe',
  AUDIO_SPEECH: 'audio:speech',
  MODELS_LIST: 'models:list',
} as const;

export type ApiKeyPermission = (typeof API_KEY_PERMISSIONS)[keyof typeof API_KEY_PERMISSIONS];

export const ALL_API_KEY_PERMISSIONS: readonly ApiKeyPermission[] =
  Object.values(API_KEY_PERMISSIONS);

export const DEFAULT_API_KEY_PERMISSIONS: readonly ApiKeyPermission[] = [
  API_KEY_PERMISSIONS.CHAT_COMPLETIONS,
  API_KEY_PERMISSIONS.MODELS_LIST,
];

export const PermissionConstants = {
  PERMISSIONS: API_KEY_PERMISSIONS,
  ALL: ALL_API_KEY_PERMISSIONS,
  DEFAULT: DEFAULT_API_KEY_PERMISSIONS,
} as const;
