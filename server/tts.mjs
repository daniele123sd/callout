import crypto from 'node:crypto';

export const TTS_VOICES = [
  { key: 'spark', name: 'Spark', description: 'Fast, energetic, short-form hook voice.', env: 'ELEVENLABS_VOICE_SPARK' },
  { key: 'debate', name: 'Debate', description: 'Confident, punchy opinion voice.', env: 'ELEVENLABS_VOICE_DEBATE' },
  { key: 'calm', name: 'Calm', description: 'Cleaner narration voice for serious takes.', env: 'ELEVENLABS_VOICE_CALM' }
];

export function ttsConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY && TTS_VOICES.every(voice => process.env[voice.env]));
}

export function publicTtsVoices() {
  return TTS_VOICES.map(({ key, name, description }) => ({ key, name, description }));
}

export function textHash(text = '') {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

export async function generateElevenLabsSpeech({ text, voiceKey }) {
  if (!ttsConfigured()) {
    const error = new Error('Text to Speech is not configured yet. Add the ElevenLabs API key and 3 voice IDs in Render.');
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
  const voiceId = process.env[voice.env];
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      text: String(text).slice(0, 900),
      model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
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
