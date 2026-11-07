'use strict';

require('dotenv').config();

const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const express = require('express');
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ASR_URL = process.env.DOUBAO_ASR_WS_URL || 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const TTS_URL = process.env.DOUBAO_TTS_WS_URL || 'wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream';
const ROOT = __dirname;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

function envKey(kind) {
  if (kind === 'asr') return process.env.DOUBAO_ASR_API_KEY || process.env.DOUBAO_API_KEY || '';
  return process.env.DOUBAO_TTS_API_KEY || process.env.DOUBAO_API_KEY || '';
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'puck.chat',
    asrProxy: true,
    ttsProxy: true,
    serverKeysConfigured: {
      asr: Boolean(envKey('asr')),
      tts: Boolean(envKey('tts'))
    }
  });
});

const ttsRate = new Map();
function limitTts(req, res, next) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = ttsRate.get(ip) || { start: now, count: 0 };
  if (now - bucket.start >= 60_000) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  ttsRate.set(ip, bucket);
  if (bucket.count > 20) return res.status(429).json({ error: '请求过于频繁，请稍后再试。' });
  next();
}

function fullClientFrame(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.from([0x11, 0x10, 0x10, 0x00]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, size, body]);
}

function parseTtsFrame(frame) {
  const buf = Buffer.from(frame);
  if (buf.length < 8) throw new Error('豆包 TTS 返回了不完整的数据帧');
  const headerSize = (buf[0] & 0x0f) * 4;
  const messageType = (buf[1] >> 4) & 0x0f;
  const flags = buf[1] & 0x0f;
  const compression = buf[2] & 0x0f;
  let offset = headerSize;

  if (messageType === 0x0f) {
    if (buf.length < offset + 8) throw new Error('豆包 TTS 返回错误帧');
    const code = buf.readUInt32BE(offset);
    const size = buf.readUInt32BE(offset + 4);
    const message = buf.subarray(offset + 8, offset + 8 + size).toString('utf8');
    return { messageType, error: 'TTS 上游错误 ' + code + ': ' + message };
  }

  let event = null;
  if (flags & 0x04) {
    if (buf.length < offset + 8) throw new Error('豆包 TTS 事件帧不完整');
    event = buf.readUInt32BE(offset);
    offset += 4;
    const sessionIdSize = buf.readUInt32BE(offset);
    offset += 4 + sessionIdSize;
  } else if (flags & 0x01 || flags & 0x03) {
    offset += 4;
  }

  if (buf.length < offset + 4) throw new Error('豆包 TTS 帧缺少 payload 长度');
  const payloadSize = buf.readUInt32BE(offset);
  offset += 4;
  let payload = buf.subarray(offset, offset + payloadSize);
  if (payload.length !== payloadSize) throw new Error('豆包 TTS payload 长度不匹配');
  if (compression === 0x01) payload = gunzipSync(payload);
  return { messageType, event, payload };
}

function synthesizeWithDoubao({ text, apiKey, resourceId, speaker, speechRate }) {
  return new Promise((resolve, reject) => {
    const headers = {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': randomUUID(),
      'X-Control-Require-Usage-Tokens-Return': '*'
    };
    const upstream = new WebSocket(TTS_URL, {
      headers,
      handshakeTimeout: 15_000,
      perMessageDeflate: false,
      maxPayload: 64 * 1024 * 1024
    });
    const audioParts = [];
    let settled = false;
    const timer = setTimeout(() => finish(new Error('豆包 TTS 请求超时')), 90_000);

    function finish(error, audio) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (upstream.readyState === WebSocket.OPEN) upstream.close(); } catch {}
      if (error) reject(error);
      else if (!audio || !audio.length) reject(new Error('豆包 TTS 没有返回音频数据，请检查音色 ID 和模型权限'));
      else resolve(audio);
    }

    upstream.on('open', () => {
      const request = {
        user: { uid: 'puck-chat' },
        req_params: {
          text,
          speaker,
          audio_params: {
            format: 'mp3',
            sample_rate: 24000,
            speech_rate: Number.isFinite(speechRate) ? Math.max(-50, Math.min(100, speechRate)) : 0,
            loudness_rate: 0
          },
          additions: JSON.stringify({ disable_markdown_filter: false, disable_emoji_filter: true })
        }
      };
      upstream.send(fullClientFrame(request), { binary: true });
    });

    upstream.on('message', (data) => {
      try {
        const packet = parseTtsFrame(data);
        if (packet.error) return finish(new Error(packet.error));
        if (packet.messageType === 0x0b && packet.event === 352 && packet.payload?.length) {
          audioParts.push(packet.payload);
        }
        if (packet.messageType === 0x09 && packet.event === 152) {
          let meta = {};
          try { meta = JSON.parse(packet.payload.toString('utf8')); } catch {}
          if (meta.status_code && meta.status_code !== 20000000) {
            return finish(new Error(meta.message || ('TTS 状态码 ' + meta.status_code)));
          }
          finish(null, Buffer.concat(audioParts));
        }
      } catch (error) {
        finish(error);
      }
    });

    upstream.on('error', (error) => finish(new Error('连接豆包 TTS 失败：' + error.message)));
    upstream.on('close', () => {
      if (!settled && audioParts.length) finish(null, Buffer.concat(audioParts));
      else if (!settled) finish(new Error('豆包 TTS 连接提前关闭，未收到完整音频'));
    });
  });
}

app.post('/api/tts', limitTts, async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: '请提供需要朗读的文本。' });
  if (text.length > 10_000) return res.status(413).json({ error: '单次朗读最多支持 10000 个字符。' });

  const apiKey = String(req.body?.apiKey || envKey('tts')).trim();
  if (!apiKey) return res.status(400).json({ error: '请在页面「语音服务设置」填写豆包 TTS API Key，或在服务端配置 DOUBAO_TTS_API_KEY。' });

  const resourceId = String(req.body?.resourceId || process.env.DOUBAO_TTS_RESOURCE_ID || 'seed-tts-2.0').trim();
  const speaker = String(req.body?.speaker || process.env.DOUBAO_TTS_SPEAKER || 'zh_female_vv_uranus_bigtts').trim();
  const speechRate = Number(req.body?.speechRate ?? 0);

  try {
    const audio = await synthesizeWithDoubao({ text, apiKey, resourceId, speaker, speechRate });
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.length),
      'Cache-Control': 'no-store',
      'X-Audio-Provider': 'doubao'
    });
    res.send(audio);
  } catch (error) {
    console.error('[TTS]', error.message);
    if (!res.headersSent) res.status(502).json({ error: error.message });
  }
});

function buildAsrAudioFrame(audio, isLast = false) {
  const body = Buffer.from(audio || Buffer.alloc(0));
  const header = Buffer.from([0x11, isLast ? 0x22 : 0x20, 0x00, 0x00]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, size, body]);
}

function parseAsrFrame(frame) {
  const buf = Buffer.from(frame);
  if (buf.length < 8) throw new Error('ASR 返回了不完整的数据帧');
  const headerSize = (buf[0] & 0x0f) * 4;
  const messageType = (buf[1] >> 4) & 0x0f;
  const flags = buf[1] & 0x0f;
  const compression = buf[2] & 0x0f;

  if (messageType === 0x0f) {
    if (buf.length < headerSize + 8) return { messageType, error: 'ASR 上游返回错误帧' };
    const code = buf.readUInt32BE(headerSize);
    const size = buf.readUInt32BE(headerSize + 4);
    const message = buf.subarray(headerSize + 8, headerSize + 8 + size).toString('utf8');
    return { messageType, error: 'ASR 上游错误 ' + code + ': ' + message };
  }

  const offsets = [];
  if (flags & 0x01 || flags & 0x03) offsets.push(headerSize + 4);
  else offsets.push(headerSize);
  if (flags & 0x04) offsets.unshift(headerSize + 4);
  let lastError = null;
  for (const sizeOffset of [...new Set(offsets)]) {
    if (buf.length < sizeOffset + 4) continue;
    const payloadSize = buf.readUInt32BE(sizeOffset);
    if (payloadSize > buf.length - sizeOffset - 4) continue;
    try {
      let payload = buf.subarray(sizeOffset + 4, sizeOffset + 4 + payloadSize);
      if (compression === 0x01) payload = gunzipSync(payload);
      const json = JSON.parse(payload.toString('utf8'));
      return { messageType, flags, json };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError ? '无法解析 ASR 返回的 JSON' : 'ASR payload 长度字段无效');
}

const asrWss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const activeAsrByIp = new Map();

function sendJson(ws, value) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
}

asrWss.on('connection', (client, req) => {
  const ip = req.socket.remoteAddress || 'unknown';
  const active = activeAsrByIp.get(ip) || 0;
  if (active >= 3) {
    sendJson(client, { type: 'error', message: '当前网络的实时识别连接过多，请稍后再试。' });
    client.close(1013, 'Too many ASR sessions');
    return;
  }
  activeAsrByIp.set(ip, active + 1);

  let upstream = null;
  let started = false;
  let stopRequested = false;
  let finalSent = false;
  let ended = false;
  let lastText = '';
  let stopTimer = null;
  let cleaned = false;

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    if (stopTimer) clearTimeout(stopTimer);
    try { if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close(); } catch {}
    const count = Math.max(0, (activeAsrByIp.get(ip) || 1) - 1);
    if (count) activeAsrByIp.set(ip, count);
    else activeAsrByIp.delete(ip);
  }

  function finish(text = lastText, reason = 'complete') {
    if (ended) return;
    ended = true;
    if (stopTimer) clearTimeout(stopTimer);
    sendJson(client, { type: 'done', text: text || lastText, reason });
    try { if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close(); } catch {}
  }

  function fail(message) {
    if (ended) return;
    ended = true;
    if (stopTimer) clearTimeout(stopTimer);
    sendJson(client, { type: 'error', message: String(message || '实时识别失败') });
    try { if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close(); } catch {}
  }

  function sendLastPacket() {
    if (finalSent) return;
    if (!upstream || upstream.readyState !== WebSocket.OPEN) {
      stopRequested = true;
      return;
    }
    finalSent = true;
    if (stopTimer) clearTimeout(stopTimer);
    upstream.send(buildAsrAudioFrame(Buffer.alloc(0), true), { binary: true });
    stopTimer = setTimeout(() => finish(lastText, 'final-timeout'), 12_000);
  }

  function openUpstream(config) {
    if (started) return;
    started = true;
    const apiKey = String(config.apiKey || envKey('asr')).trim();
    if (!apiKey) return fail('请在页面「语音服务设置」填写豆包 ASR API Key，或在服务端配置 DOUBAO_ASR_API_KEY。');
    const resourceId = String(config.resourceId || process.env.DOUBAO_ASR_RESOURCE_ID || 'volc.seedasr.sauc.duration').trim();
    const requestId = randomUUID();
    const headers = {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
      'X-Api-Connect-Id': randomUUID()
    };

    upstream = new WebSocket(ASR_URL, {
      headers,
      handshakeTimeout: 15_000,
      perMessageDeflate: false,
      maxPayload: 16 * 1024 * 1024
    });

    upstream.on('open', () => {
      const request = {
        user: { uid: 'puck-chat' },
        audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: false,
          enable_nonstream: true,
          show_utterances: true,
          result_type: 'full',
          end_window_size: 800,
          force_to_speech_time: 1000
        }
      };
      upstream.send(fullClientFrame(request), { binary: true });
      sendJson(client, { type: 'ready', requestId });
      if (stopRequested) sendLastPacket();
    });

    upstream.on('message', (data) => {
      try {
        const packet = parseAsrFrame(data);
        if (packet.error) return fail(packet.error);
        if (packet.messageType !== 0x09) return;
        const root = packet.json || {};
        if (root.code && root.code !== 0) return fail('ASR 识别失败（' + root.code + '）：' + (root.message || '上游返回错误'));
        const result = root.payload_msg?.result || root.result || {};
        const text = typeof result.text === 'string' ? result.text : '';
        if (text) lastText = text;
        if (text || result.utterances?.length) {
          sendJson(client, {
            type: 'result',
            text: text || lastText,
            utterances: result.utterances || [],
            final: Boolean(root.is_last_package),
            logId: result.additions?.log_id || root.payload_msg?.result?.additions?.log_id || ''
          });
        }
        if (root.is_last_package) finish(text || lastText, 'complete');
      } catch (error) {
        fail(error.message);
      }
    });

    upstream.on('error', (error) => fail('连接豆包 ASR 失败：' + error.message));
    upstream.on('close', () => {
      if (!ended) {
        if (lastText) finish(lastText, 'upstream-closed');
        else fail('豆包 ASR 连接提前关闭，未收到识别结果。');
      }
    });
  }

  client.on('message', (data, isBinary) => {
    if (isBinary) {
      if (!upstream || upstream.readyState !== WebSocket.OPEN || ended) return;
      const audio = Buffer.from(data);
      if (audio.length > 128 * 1024) return fail('音频分包过大。');
      upstream.send(buildAsrAudioFrame(audio, false), { binary: true });
      return;
    }

    let message;
    try { message = JSON.parse(data.toString('utf8')); }
    catch { return fail('客户端消息格式无效。'); }

    if (message.type === 'start') openUpstream(message);
    else if (message.type === 'stop') sendLastPacket();
  });

  client.on('close', cleanup);
  client.on('error', cleanup);
});

const server = http.createServer(app);
server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch {}
  if (pathname !== '/api/asr/ws') return socket.destroy();

  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        return socket.destroy();
      }
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
  }
  asrWss.handleUpgrade(req, socket, head, (ws) => asrWss.emit('connection', ws, req));
});

app.use(express.static(ROOT, { index: 'index.html', dotfiles: 'deny', fallthrough: true }));
app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

server.listen(PORT, HOST, () => {
  console.log('puck.chat listening on http://' + HOST + ':' + PORT);
});

function shutdown() {
  try { asrWss.clients.forEach((client) => client.close(1001, 'Server shutting down')); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
