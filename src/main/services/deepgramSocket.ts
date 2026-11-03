import https from 'node:https';
import type { ClientRequest } from 'node:http';
import crypto from 'node:crypto';
import type { Socket } from 'node:net';

export interface ISocket {
  readonly readyState: number;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((err: Error | any) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

export class NodeDeepgramWebSocket implements ISocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = NodeDeepgramWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((err: Error | any) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  private socket: Socket | null = null;
  private req: ClientRequest | null = null;
  private incomingBuffer: Buffer = Buffer.alloc(0);

  constructor(urlStr: string, apiKey: string) {
    this.connect(urlStr, apiKey);
  }

  private connect(urlStr: string, apiKey: string): void {
    try {
      const url = new URL(urlStr);
      const key = crypto.randomBytes(16).toString('base64');
      const cleanKey = apiKey.trim();

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          Host: url.hostname,
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Protocol': `token, ${cleanKey}`,
          Authorization: `Token ${cleanKey}`,
        },
      };

      const req = https.request(options);
      this.req = req;

      req.on('upgrade', (res, socket, head) => {
        this.socket = socket;
        this.readyState = NodeDeepgramWebSocket.OPEN;

        socket.on('data', (chunk: Buffer) => {
          this.handleData(chunk);
        });

        socket.on('error', (err) => {
          this.readyState = NodeDeepgramWebSocket.CLOSED;
          this.onerror?.(err);
        });

        socket.on('close', () => {
          if (this.readyState !== NodeDeepgramWebSocket.CLOSED) {
            this.readyState = NodeDeepgramWebSocket.CLOSED;
            this.onclose?.({ code: 1000, reason: 'Socket closed' });
          }
        });

        if (head && head.length > 0) {
          this.handleData(head);
        }

        this.onopen?.();
      });

      req.on('response', (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          this.readyState = NodeDeepgramWebSocket.CLOSED;
          let message = `Deepgram connection failed (HTTP ${res.statusCode})`;
          if (res.statusCode === 401) {
            message = 'Invalid Deepgram API key. Please check your credentials in Settings.';
          } else if (res.statusCode === 402) {
            message = 'Deepgram account has insufficient credits. Please check your Deepgram dashboard.';
          } else if (body) {
            try {
              const parsed = JSON.parse(body) as { err_msg?: string; message?: string };
              message = parsed.err_msg || parsed.message || message;
            } catch {
              message += `: ${body}`;
            }
          }
          const err = new Error(message);
          this.onerror?.(err);
          this.onclose?.({ code: 1002, reason: message });
        });
      });

      req.on('error', (err) => {
        this.readyState = NodeDeepgramWebSocket.CLOSED;
        this.onerror?.(err);
        this.onclose?.({ code: 1006, reason: err.message });
      });

      req.end();
    } catch (err) {
      this.readyState = NodeDeepgramWebSocket.CLOSED;
      this.onerror?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== NodeDeepgramWebSocket.OPEN || !this.socket) {
      return;
    }

    let payload: Buffer;
    let opcode: number;

    if (typeof data === 'string') {
      payload = Buffer.from(data, 'utf8');
      opcode = 1; // Text
    } else if (data instanceof ArrayBuffer) {
      payload = Buffer.from(data);
      opcode = 2; // Binary
    } else if (ArrayBuffer.isView(data)) {
      payload = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      opcode = 2; // Binary
    } else {
      return;
    }

    const frame = this.encodeFrame(payload, opcode);
    this.socket.write(frame);
  }

  private encodeFrame(payload: Buffer, opcode: number): Buffer {
    const length = payload.length;
    let header: Buffer;

    if (length <= 125) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | length;
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    const mask = crypto.randomBytes(4);
    const masked = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
      masked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
    }

    return Buffer.concat([header, mask, masked]);
  }

  private handleData(chunk: Buffer): void {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk]);

    while (this.incomingBuffer.length >= 2) {
      let len = (this.incomingBuffer[1] ?? 0) & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.incomingBuffer.length < 4) break;
        len = this.incomingBuffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.incomingBuffer.length < 10) break;
        len = Number(this.incomingBuffer.readBigUInt64BE(2));
        offset = 10;
      }

      const total = offset + len;
      if (this.incomingBuffer.length < total) break;

      const opcode = (this.incomingBuffer[0] ?? 0) & 0x0f;
      const payload = this.incomingBuffer.subarray(offset, total);
      this.incomingBuffer = this.incomingBuffer.subarray(total);

      if (opcode === 1) {
        const text = payload.toString('utf8');
        this.onmessage?.({ data: text });
      } else if (opcode === 8) {
        this.readyState = NodeDeepgramWebSocket.CLOSED;
        let code = 1000;
        let reason = 'Normal closure';
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.subarray(2).toString('utf8');
        }
        this.onclose?.({ code, reason });
        this.socket?.end();
      } else if (opcode === 9) {
        const pong = this.encodeFrame(payload, 10);
        this.socket?.write(pong);
      }
    }
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === NodeDeepgramWebSocket.CLOSED) return;
    if (this.readyState === NodeDeepgramWebSocket.CONNECTING) {
      this.readyState = NodeDeepgramWebSocket.CLOSED;
      this.req?.destroy();
      this.socket?.destroy();
      this.onclose?.({ code, reason });
      return;
    }
    this.readyState = NodeDeepgramWebSocket.CLOSING;

    try {
      const reasonBuf = Buffer.from(reason, 'utf8');
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      const closeFrame = this.encodeFrame(payload, 8);
      this.socket?.write(closeFrame, () => {
        this.socket?.end();
        this.readyState = NodeDeepgramWebSocket.CLOSED;
        this.onclose?.({ code, reason });
      });
    } catch {
      this.socket?.destroy();
      this.readyState = NodeDeepgramWebSocket.CLOSED;
    }
  }
}

export function createDeepgramSocket(url: string, apiKey: string): ISocket {
  if (typeof (globalThis as any).WebSocket !== 'undefined') {
    const WS = (globalThis as any).WebSocket;
    return new WS(url, ['token', apiKey.trim()]) as ISocket;
  }
  return new NodeDeepgramWebSocket(url, apiKey);
}

