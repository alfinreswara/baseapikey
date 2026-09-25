import assert from 'node:assert/strict';

import { ProviderRegistry, type IProviderAdapter } from '@baseapikey/shared';

import { InferenceService } from './services/inference.service';
import { parseAudioMultipart } from './utils/multipart.util';

async function run(): Promise<void> {
  const adapter: IProviderAdapter = {
    getName: () => 'test-provider',
    getCapabilities: () => ({
      supportsChat: true,
      supportsStreaming: true,
      supportsModels: true,
      supportsEmbeddings: true,
      supportsImages: true,
      supportsAudio: true,
    }),
    chat: async () => ({
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'model',
      provider: 'test-provider',
      choices: [],
    }),
    streamChat: async () => (async function* () {})(),
    chatCompletion: async () => ({
      id: 'id',
      object: 'chat.completion',
      created: 1,
      model: 'model',
      provider: 'test-provider',
      choices: [],
    }),
    listModels: async () => [],
    healthCheck: async () => ({
      status: 'healthy',
      provider: 'test-provider',
      checkedAt: new Date(),
    }),
    createEmbedding: async (request) => ({
      object: 'list',
      data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }],
      model: request.model,
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }),
    createImage: async () => ({ created: 1, data: [{ url: 'https://images.example/1.png' }] }),
    createSpeech: async () => ({ data: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg' }),
    transcribeAudio: async (request) => ({ text: `${request.filename}:${request.file.length}` }),
  };
  const registry = new ProviderRegistry();
  registry.register(adapter);
  const service = new InferenceService(registry, 'test-provider');
  const embedding = await service.createEmbedding({ model: 'embed-model', input: 'hello' });
  assert.equal(embedding.data[0]?.embedding[0], 0.1);
  const image = await service.createImage({ prompt: 'a lighthouse' });
  assert.equal(image.data[0]?.url, 'https://images.example/1.png');
  const speech = await service.createSpeech({ model: 'tts', input: 'hello', voice: 'alloy' });
  assert.deepEqual([...speech.data], [1, 2, 3]);

  const boundary = 'test-boundary';
  const multipartBody = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\nabc\r\n--${boundary}--\r\n`,
  );
  const parsed = parseAudioMultipart(multipartBody, `multipart/form-data; boundary=${boundary}`);
  assert.equal(parsed.fields['model'], 'whisper-1');
  assert.equal(parsed.file.filename, 'audio.wav');
  const transcription = await service.transcribeAudio({ model: 'whisper-1' }, parsed.file);
  assert.deepEqual(transcription, { text: 'audio.wav:3' });
  console.log('✅ Embeddings, images, speech, transcription, and multipart tests passed');
}

void run();
