// Cartesia access tokens. The browser opens the STT and TTS websockets itself, straight to
// Cartesia, with a short-lived token minted here, so the API key never leaves this process and
// no audio passes through the proxy. A token only has to be valid when a socket opens.
export const CARTESIA_VERSION = '2026-08-14';
const TOKEN_SECONDS = 60;

export const hasCartesiaKey = () => !!(process.env.CARTESIA_API_KEY ?? '').trim();

export async function voiceToken(): Promise<{ token: string; expiresIn: number; version: string }> {
  const r = await fetch('https://api.cartesia.ai/access-token', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${(process.env.CARTESIA_API_KEY ?? '').trim()}`,
      'Cartesia-Version': CARTESIA_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ grants: { stt: true, tts: true }, expires_in: TOKEN_SECONDS }),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`cartesia token: ${r.status} ${(await r.text()).slice(0, 120)}`);
  const { token } = (await r.json()) as { token?: string };
  if (!token) throw new Error('cartesia token: none in response');
  return { token, expiresIn: TOKEN_SECONDS, version: CARTESIA_VERSION };
}
