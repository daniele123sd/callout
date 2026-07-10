import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { AdminIntegration } from './models/AdminIntegration.mjs';

export const TTS_VOICES = [
  { key: 'spark', name: 'Spark', description: 'Fast, energetic, short-form hook voice.', env: 'ELEVENLABS_VOICE_SPARK' },
  { key: 'debate', name: 'Debate', description: 'Confident, punchy opinion voice.', env: 'ELEVENLABS_VOICE_DEBATE' },
  { key: 'calm', name: 'Calm', description: 'Cleaner narration voice for serious takes.', env: 'ELEVENLABS_VOICE_CALM' }
];

const INTEGRATION_KEY = 'elevenlabs-tts';
let memoryTtsIntegration = null;

const encryptionKey = () => crypto.createHash('sha256').update(`${process.env.JWT_SECRET || ''}:callout:tts`).digest();

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encryptedRefreshToken = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64');
  return { encryptedRefreshToken, tokenIv: iv.toString('base64'), tokenTag: cipher.getAuthTag().toString('base64') };
}

function decrypt(record) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.tokenIv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tokenTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.encryptedRefreshToken, 'base64')), decipher.final()]).toString('utf8');
}

async function getIntegration() {
  if (mongoose.connection.readyState !== 1) return memoryTtsIntegration;
  return AdminIntegration.findOne({ key: INTEGRATION_KEY }).select('+encryptedRefreshToken +tokenIv +tokenTag').lean().exec();
}

function envSettings() {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
    voiceIds: Object.fromEntries(TTS_VOICES.map(voice => [voice.key, process.env[voice.env] || ''])),
    source: 'env'
  };
}

export async function getTtsSettings({ includeSecret = false } = {}) {
  const integration = await getIntegration();
  let apiKey = '';
  let settings = {};
  let source = 'none';
  if (integration?.encryptedRefreshToken) {
    apiKey = decrypt(integration);
    settings = integration.settings || {};
    source = 'saved';
  } else {
    const env = envSettings();
    apiKey = env.apiKey;
    settings = { modelId: env.modelId, voiceIds: env.voiceIds };
    source = env.apiKey ? 'env' : 'none';
  }
  const voiceIds = { spark: '', debate: '', calm: '', ...(settings.voiceIds || {}) };
  const configured = Boolean(apiKey && TTS_VOICES.every(voice => voiceIds[voice.key]));
  return {
    configured,
    source,
    modelId: settings.modelId || process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
    voiceIds: includeSecret ? voiceIds : Object.fromEntries(Object.entries(voiceIds).map(([key, value]) => [key, value ? `••••${String(value).slice(-4)}` : ''])),
    hasApiKey: Boolean(apiKey),
    apiKey: includeSecret ? apiKey : '',
    apiKeyPreview: apiKey ? `••••${apiKey.slice(-4)}` : ''
  };
}

export async function saveTtsSettings(values, connectedBy) {
  const existing = await getTtsSettings({ includeSecret: true });
  const apiKey = values.apiKey || existing.apiKey;
  if (!apiKey) {
    const error = new Error('Paste your ElevenLabs API key before saving.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  const voiceIds = { spark: values.sparkVoiceId, debate: values.debateVoiceId, calm: values.calmVoiceId };
  if (Object.values(voiceIds).some(value => !value)) {
    const error = new Error('Add all three ElevenLabs voice IDs before saving.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  const encrypted = encrypt(apiKey);
  const settings = { modelId: values.modelId || 'eleven_multilingual_v2', voiceIds };
  const record = { key: INTEGRATION_KEY, ...encrypted, settings, connectedBy, accountName: 'ElevenLabs Text to Speech' };
  if (mongoose.connection.readyState !== 1) { memoryTtsIntegration = record; return getTtsSettings(); }
  await AdminIntegration.findOneAndUpdate({ key: INTEGRATION_KEY }, record, { upsert: true, new: true }).exec();
  return getTtsSettings();
}

export async function ttsConfigured() {
  return (await getTtsSettings()).configured;
}

export function publicTtsVoices() {
  return TTS_VOICES.map(({ key, name, description }) => ({ key, name, description }));
}

export function textHash(text = '') {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

export async function generateElevenLabsSpeech({ text, voiceKey }) {
  const settings = await getTtsSettings({ includeSecret: true });
  if (!settings.configured) {
    const error = new Error('Text to Speech is not connected yet. The site owner can add ElevenLabs settings inside Callout.');
    error.statusCode = 503;
    error.expose = true;
    throw error;
  }
  const voice = TTS_VOICES.find(item => item.key === voiceKey);
  if (!voice) {
    const error = new Error('Choose one of the available Callout voices.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  const voiceId = settings.voiceIds[voice.key];
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': settings.apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      text: String(text).slice(0, 900),
      model_id: settings.modelId || 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.35,
        use_speaker_boost: true
      }
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    const error = new Error(response.status === 401 ? 'ElevenLabs rejected the API key.' : `ElevenLabs could not generate audio right now.${details ? ` ${details.slice(0, 180)}` : ''}`);
    error.statusCode = response.status === 401 ? 503 : 502;
    error.expose = true;
    throw error;
  }
  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.byteLength > 2_200_000) {
    const error = new Error('Generated audio was too large. Try a shorter post.');
    error.statusCode = 413;
    error.expose = true;
    throw error;
  }
  return {
    voiceKey: voice.key,
    voiceName: voice.name,
    mimeType: 'audio/mpeg',
    audioBase64: audioBuffer.toString('base64'),
    textHash: textHash(text),
    generatedAt: new Date()
  };
}
