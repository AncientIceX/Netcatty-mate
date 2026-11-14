/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Netcatty Mate Mobile - Android Native Bridge Polyfill (`window.netcatty` & `window.electron`)
 *
 * Bridges the official Netcatty React 19 + TypeScript + Tailwind + xterm.js 5.5.0 frontend
 * directly to the Android native engine (`MainActivity.java` via `window.NativeBridge`,
 * powered by mwiede/jsch 0.2.21 + BouncyCastle 1.79).
 *
 * Enforces strict mobile safety rules:
 * 1. Cloud Sync is strictly PULL-ONLY (read-only download/merge from Gist/WebDAV/S3;
 *    never uploads or overwrites remote vaults).
 * 2. SFTP supports explicit user-initiated bidirectional remote file operations.
 */

interface AndroidNativeBridge {
  getDeviceSysInfo(): string;
  vibrateShort(): void;
  openExternalUrl(url: string): void;
  openExternal(url: string): void;
  requestOpenFilePicker(callbackId: string): void;
  setStatusBarColorHex(hexColor: string): void;
  copyToClipboard(text: string): void;
  readClipboard(): string;
  credentialsAvailable(): boolean;
  credentialsEncrypt(plaintext: string): string;
  credentialsDecrypt(ciphertext: string): string;

  // SSH / Local Shell / TCP Sessions
  connectSshSession(reqId: string, jsonConfig: string): void;
  testSshConnection(reqId: string, jsonConfig: string): void;
  writeTerminalBytesB64(sessionId: string, dataB64: string): void;
  resizeSshPty(sessionId: string, cols: number, rows: number): void;
  startLocalShell(reqId: string, sessionId: string, initDir: string): void;
  connectTcpSession(reqId: string, sessionId: string, host: string, port: number): void;
  closeSession(sessionId: string): void;

  // SFTP Operations
  sftpOpenSession(reqId: string, sftpId: string, sourceSessionId: string, sshConfigJson: string): void;
  sftpList(reqId: string, sftpId: string, remotePath: string): void;
  sftpStat(reqId: string, sftpId: string, remotePath: string, followLinks: boolean): void;
  sftpHomeAndRealpath(reqId: string, sftpId: string, remotePath: string): void;
  sftpReadFile(reqId: string, sftpId: string, remotePath: string, asBase64: boolean): void;
  sftpWriteFile(reqId: string, sftpId: string, remotePath: string, contentOrB64: string, isBase64: boolean): void;
  sftpMkdir(reqId: string, sftpId: string, remotePath: string): void;
  sftpDelete(reqId: string, sftpId: string, remotePath: string): void;
  sftpRename(reqId: string, sftpId: string, oldPath: string, newPath: string): void;
  sftpChmod(reqId: string, sftpId: string, remotePath: string, modeOctal: string): void;
  sftpStreamUploadFromLocal(
    reqId: string,
    transferId: string,
    sftpId: string,
    localPath: string,
    remotePath: string,
  ): void;
  sftpStreamDownloadToLocal(
    reqId: string,
    transferId: string,
    sftpId: string,
    remotePath: string,
    localPath: string,
  ): void;
  cancelSftpTransfer(transferId: string): void;
  sftpCloseSession(sftpId: string): void;

  // SSH Exec, Server Stats & System Probes
  sshExecOnSession(
    reqId: string,
    sessionId: string,
    sshConfigJson: string,
    command: string,
    timeoutMs: number,
    stdinData: string,
  ): void;
  sshGetServerStats(reqId: string, sessionId: string): void;
  getSessionRemoteInfoSync(sessionId: string): string;

  // Port Forwarding
  startSshPortForward(reqId: string, optionsJson: string): void;
  stopSshPortForward(tunnelId: string): void;
  stopAllSshPortForwards(): void;
  listPortForwardsSync(): string;

  // Keygen
  generateRealSshKey(keyType: string, bits: number, comment: string): string;

  // Local Sandbox FS
  getHomeDirSync(): string;
  listLocalFiles(dirPath: string): string;
  statLocalFileSync(filePath: string): string;
  readLocalFileB64(filePath: string, maxBytes: number): string;
  writeLocalFileB64(filePath: string, contentB64: string): boolean;
  writeLocalFileText(filePath: string, content: string): boolean;
  deleteLocalFile(filePath: string): boolean;
  renameLocalFile(oldPath: string, newPath: string): boolean;
  mkdirLocal(dirPath: string): boolean;

  // HTTP & AI Stream
  httpFetchAsync(
    reqId: string,
    urlStr: string,
    method: string,
    headersJson: string,
    bodyStr: string,
    skipTlsVerify: boolean,
  ): void;
  startAiChatStream(
    reqId: string,
    streamRequestId: string,
    urlStr: string,
    headersJson: string,
    bodyStr: string,
    skipTlsVerify: boolean,
  ): void;
  cancelAiChatStream(streamRequestId: string): boolean;
}

declare global {
  interface Window {
    NativeBridge?: AndroidNativeBridge;
    __onNativeEvent?: (eventType: string, b64Payload: string) => void;
    __onTerminalBytesB64?: (sessionId: string, b64Bytes: string) => void;
    __handleAndroidBack?: () => boolean;
    __netcattyMobileMode?: boolean;
    __netcattyOpenMobileSettings?: () => void;
    __netcattyCloseMobileSettings?: () => void;
  }
}

function shellQuote(value: string): string {
  if (value.includes('\0')) throw new Error('NUL is not a valid shell argument');
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

async function unsupportedMobile(): Promise<never> { throw new Error('Unsupported on Android'); }

function getNative(): AndroidNativeBridge | null {
  return typeof window !== 'undefined' && window.NativeBridge ? window.NativeBridge : null;
}

export function isAndroidMobileRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.NativeBridge) return true;
  if (window.__netcattyMobileMode) return true;
  return /Android|Mobile/i.test(navigator.userAgent || '');
}

function utf8ToB64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function b64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function b64ToUtf8(b64: string): string {
  try {
    return new TextDecoder('utf-8').decode(b64ToUint8Array(b64));
  } catch {
    return atob(b64);
  }
}

function arrayBufferToB64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ============================================================================
// Pure WebCrypto Helpers: RFC 6238 TOTP & AWS Signature V4 (S3 Pull-Only)
// ============================================================================
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32Bytes(input: string): Uint8Array | null {
  const cleaned = String(input || '')
    .replace(/=+$/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (!cleaned || /[^A-Z2-7]/.test(cleaned)) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(cleaned[i]);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function encodeBase32Bytes(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

async function previewTotpWebCrypto(payload: any): Promise<any> {
  const text = String(typeof payload?.text === 'string' ? payload.text : payload?.uri || '').trim();
  if (!text) return { ok: false, error: 'empty' };
  if (/^otpauth-migration:/i.test(text)) return { ok: false, error: 'migration' };

  let secretBytes: Uint8Array | null = null;
  let algorithm: 'SHA1' | 'SHA256' | 'SHA512' = 'SHA1';
  let digits = 6;
  let period = 30;
  let issuer = '';
  let label = '';

  if (/^otpauth:/i.test(text)) {
    let u: URL;
    try {
      u = new URL(text);
    } catch {
      return { ok: false, error: 'invalid-uri' };
    }
    const type = (u.hostname || '').toLowerCase();
    if (!type) return { ok: false, error: 'invalid-uri' };
    if (type === 'hotp') return { ok: false, error: 'hotp' };
    if (type !== 'totp') return { ok: false, error: 'unsupported-type' };
    const secretParam = u.searchParams.get('secret') || '';
    if (!secretParam.trim()) return { ok: false, error: 'missing-secret' };
    secretBytes = decodeBase32Bytes(secretParam);
    if (!secretBytes || (secretBytes.length < 10 || secretBytes.length > 128)) return { ok: false, error: 'invalid-secret' };
    const algParam = String(u.searchParams.get('algorithm') || 'SHA1').replace(/-/g, '').toUpperCase();
    if (algParam === 'SHA1' || algParam === 'SHA256' || algParam === 'SHA512') {
      algorithm = algParam;
    } else {
      return { ok: false, error: 'invalid-algorithm' };
    }
    const dText = u.searchParams.get('digits');
    digits = dText == null || !dText.trim() ? 6 : Number(dText);
    if (!Number.isInteger(digits) || digits < 6 || digits > 8) return { ok: false, error: 'invalid-digits' };
    const pText = u.searchParams.get('period');
    period = pText == null || !pText.trim() ? 30 : Number(pText);
    if (!Number.isInteger(period) || period < 1 || period > 300) return { ok: false, error: 'invalid-period' };
    let rawPath: string;
    try { rawPath = decodeURIComponent(u.pathname.replace(/^\//, '')).trim(); }
    catch { return { ok: false, error: 'invalid-uri' }; }
    issuer = (u.searchParams.get('issuer') || '').trim();
    label = rawPath;
    if (!issuer && rawPath.includes(':')) {
      const idx = rawPath.indexOf(':');
      issuer = rawPath.slice(0, idx).trim();
      label = rawPath.slice(idx + 1).trim();
    } else if (issuer && rawPath.toLowerCase().startsWith(`${issuer.toLowerCase()}:`)) {
      label = rawPath.slice(issuer.length + 1).trim();
    }
  } else {
    secretBytes = decodeBase32Bytes(text);
    if (!secretBytes || (secretBytes.length < 10 || secretBytes.length > 128)) return { ok: false, error: 'invalid-secret' };
  }

  const now = Date.now();
  const periodMs = period * 1000;
  const into = now % periodMs;
  const remainingMs = into === 0 ? periodMs : periodMs - into;
  const secondsRemaining = Math.ceil(remainingMs / 1000);
  const counter = Math.floor(now / 1000 / period);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }

  const webAlgo = algorithm === 'SHA256' ? 'SHA-256' : algorithm === 'SHA512' ? 'SHA-512' : 'SHA-1';
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    secretBytes.buffer.slice(secretBytes.byteOffset, secretBytes.byteOffset + secretBytes.byteLength) as ArrayBuffer,
    { name: 'HMAC', hash: webAlgo },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg));
  const offset = sig[sig.length - 1] & 0x0f;
  const binary =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  const code = String(binary % 10 ** digits).padStart(digits, '0');

  const account = label || issuer || 'TOTP';
  const pathLabel = issuer && label && !label.startsWith(`${issuer}:`) ? `${issuer}:${label}` : account;
  const params = new URLSearchParams();
  params.set('secret', encodeBase32Bytes(secretBytes));
  params.set('algorithm', algorithm);
  params.set('digits', String(digits));
  params.set('period', String(period));
  if (issuer) params.set('issuer', issuer);
  const uri = `otpauth://totp/${encodeURIComponent(pathLabel)}?${params.toString()}`;

  return {
    ok: true,
    uri,
    code,
    secondsRemaining,
    period,
    algorithm,
    digits,
    issuer,
    label,
  };
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return toHex(new Uint8Array(digest));
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const rawKey =
    key instanceof Uint8Array
      ? (key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer)
      : key;
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(msg));
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function buildAwsSigV4SignedRequest(
  config: any,
  method: 'GET' | 'HEAD',
  objectKey: string,
): Promise<{ url: string; headers: Record<string, string> }> {
  const rawEndpoint = String(config.endpoint || '').trim();
  const normalizedEndpoint = /^https?:\/\//i.test(rawEndpoint) ? rawEndpoint : `https://${rawEndpoint}`;
  const baseUrl = new URL(normalizedEndpoint);
  const region = String(config.region || 'us-east-1').trim() || 'us-east-1';
  const bucket = String(config.bucket || '').trim();
  const forcePathStyle = config.forcePathStyle !== false;

  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  const encodedKey = objectKey
    .split('/')
    .map(encodeRfc3986)
    .join('/');

  let targetHost = baseUrl.host;
  let canonicalUri = '/';
  if (forcePathStyle) {
    canonicalUri = `${basePath}/${encodeRfc3986(bucket)}/${encodedKey}`;
  } else {
    targetHost = `${bucket}.${baseUrl.host}`;
    canonicalUri = `${basePath}/${encodedKey}`;
  }
  // URL/HTTP clients normalize dot segments: reject rather than sign a different key.
  if (objectKey.split('/').some((part) => part === '.' || part === '..')) throw new Error('S3 dot-segment keys unsupported on Android');
  if (baseUrl.search || baseUrl.hash || baseUrl.username || baseUrl.password) throw new Error('S3 endpoint must not contain credentials, query or fragment');
  const finalUrl = `${baseUrl.protocol}//${targetHost}${canonicalUri}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex('');

  const signHeaders: Record<string, string> = {
    host: targetHost,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (config.sessionToken) {
    signHeaders['x-amz-security-token'] = String(config.sessionToken).trim();
  }
  const sortedKeys = Object.keys(signHeaders).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${signHeaders[k].trim()}\n`).join('');
  const signedHeaders = sortedKeys.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kSecret = new TextEncoder().encode(`AWS4${String(config.secretAccessKey || '')}`);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, 's3');
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(new Uint8Array(await hmacSha256(kSigning, stringToSign)));

  const authorization = `AWS4-HMAC-SHA256 Credential=${String(config.accessKeyId || '').trim()}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const outHeaders: Record<string, string> = {
    Authorization: authorization,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
  if (config.sessionToken) {
    outHeaders['x-amz-security-token'] = String(config.sessionToken).trim();
  }
  return { url: finalUrl, headers: outHeaders };
}

let reqCounter = 1;
function nextReqId(prefix = 'nc'): string {
  reqCounter += 1;
  return `${prefix}-${Date.now()}-${reqCounter}`;
}

export function installAndroidBridgePolyfill(): void {
  if (typeof window === 'undefined') return;
  // Do not overwrite real Electron desktop preload bridge
  if (window.netcatty && !window.NativeBridge && (window as any).electron?.ipcRenderer) {
    return;
  }

  window.__netcattyMobileMode = true;
  document.documentElement.setAttribute('data-netcatty-mobile', 'true');

  // Ensure mobile defaults on first boot: bottom side panel dock & compact touch friendly sizing
  try {
    if (!localStorage.getItem('netcatty_side_panel_position')) {
      localStorage.setItem('netcatty_side_panel_position', JSON.stringify('bottom'));
    }
    if (!localStorage.getItem('netcatty_vault_sidebar_collapsed') && window.innerWidth < 768) {
      localStorage.setItem('netcatty_vault_sidebar_collapsed', 'true');
    }
  } catch {
    // ignore storage errors
  }

  // Listener registries
  const pendingAsync = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: number }
  >();
  const pendingConnects = new Map<
    string,
    { sessionId: string; resolve: (sid: string) => void; reject: (err: Error) => void; timer: number }
  >();

  const dataListeners = new Map<string, Set<(data: string, meta?: any) => void>>();
  const sessionBacklog = new Map<string, string>();
  const exitListeners = new Map<string, Set<(payload: any) => void>>();
  const authFailedListeners = new Map<string, Set<(payload: any) => void>>();
  const sftpProgressListeners = new Set<
    (sessionId: string, label: string, status: string, detail?: string) => void
  >();
  const globalSftpTransferListeners = new Set<(payload: any) => void>();
  const portForwardStatusListeners = new Map<string, Set<(status: any, error?: string) => void>>();
  const portForwardRuntimeListeners = new Set<(payload: any) => void>();
  const settingsChangedListeners = new Set<(payload: { key: string; value: unknown }) => void>();
  const aiStreamDataListeners = new Map<string, Set<(data: string) => void>>();
  const aiStreamEndListeners = new Map<string, Set<() => void>>();
  const aiStreamErrorListeners = new Map<string, Set<(err: string) => void>>();
  const pasteWriteListeners = new Set<(payload: any) => void>();

  const sftpLeases = new Map<string, Set<string>>();
  const deferredSftpClose = new Set<string>();

  const sftpProgressCallbacks = new Map<string, (transferred: number, totalBytes: number, speed: number) => void>();
  const pendingFilePickers = new Map<string, (res: { canceled: boolean; filePath?: string; fileName?: string; error?: string }) => void>();
  const editorOpenTabListeners = new Set<(snapshot: any) => void>();

  // Per-session UTF-8 streaming decoder so split multi-byte sequences never corrupt
  const sessionDecoders = new Map<string, TextDecoder>();

  // Install global Android hardware back-button handler
  (window as any).__netcattyHandleBackPress = (): boolean => {
    try {
      // 1. Close any open Radix Dialog / Popover / ContextMenu / Sheet via Escape key
      const openLayer = document.querySelector(
        '[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper], [data-state="open"][role="menu"]',
      );
      if (openLayer) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }),
        );
        return true;
      }
      // 2. Delegate to AppView back handler (closes mobile settings -> switches from terminal/sftp to vault)
      if (window.__handleAndroidBack && window.__handleAndroidBack !== (window as any).__netcattyHandleBackPress) {
        if (window.__handleAndroidBack()) return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  function callNativeAsync<T = any>(
    invoke: (reqId: string) => void,
    timeoutMs = 30000,
    onTimeout?: () => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const reqId = nextReqId('async');
      const timer = window.setTimeout(() => {
        pendingAsync.delete(reqId);
        try { onTimeout?.(); } catch { /* still settle timeout */ }
        reject(new Error(`Native operation timed out (${timeoutMs}ms)`));
      }, timeoutMs);
      pendingAsync.set(reqId, { resolve, reject, timer });
      try {
        invoke(reqId);
      } catch (err) {
        window.clearTimeout(timer);
        pendingAsync.delete(reqId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // Install global callbacks invoked from MainActivity.java
  window.__onTerminalBytesB64 = (sessionId: string, b64Bytes: string) => {
    if (!sessionId || !b64Bytes) return;
    const rawBytes = b64ToUint8Array(b64Bytes);
    let decoder = sessionDecoders.get(sessionId);
    if (!decoder) {
      decoder = new TextDecoder('utf-8', { fatal: false });
      sessionDecoders.set(sessionId, decoder);
    }
    const text = decoder.decode(rawBytes, { stream: true });
    if (!text) return;

    const listeners = dataListeners.get(sessionId);
    if (listeners && listeners.size > 0) {
      listeners.forEach((cb) => {
        try {
          cb(text, undefined);
        } catch (err) {
          console.error('[MobileBridge] onSessionData listener error:', err);
        }
      });
    } else {
      const prev = sessionBacklog.get(sessionId) || '';
      const combined = prev + text;
      sessionBacklog.set(sessionId, combined.length > 128 * 1024 ? combined.slice(-128 * 1024) : combined);
    }
  };

  window.__onNativeEvent = (eventType: string, b64Payload: string) => {
    let payload: any = {};
    try {
      payload = JSON.parse(b64ToUtf8(b64Payload));
    } catch (err) {
      console.error('[MobileBridge] Failed to parse native event:', eventType, err);
      return;
    }

    if (eventType === 'async_response') {
      const reqId = payload?.reqId;
      const pending = reqId ? pendingAsync.get(reqId) : undefined;
      if (pending) {
        window.clearTimeout(pending.timer);
        pendingAsync.delete(reqId);
        if ((payload.ok === false || payload.success === false) && payload.error && payload.status === undefined) {
          pending.reject(new Error(payload.error));
        } else {
          pending.resolve(payload);
        }
      }
      return;
    }

    if (eventType === 'ssh_connected') {
      const reqId = payload?.reqId;
      const sessionId = payload?.sessionId;
      if (reqId && pendingConnects.has(reqId)) {
        const pending = pendingConnects.get(reqId)!;
        window.clearTimeout(pending.timer);
        pendingConnects.delete(reqId);
        pending.resolve(sessionId || pending.sessionId);
      }
      return;
    }

    if (eventType === 'terminal_error') {
      const reqId = payload?.reqId;
      const sessionId = payload?.sessionId;
      const errorMsg = payload?.error || 'Connection error';
      if (reqId && pendingConnects.has(reqId)) {
        const pending = pendingConnects.get(reqId)!;
        window.clearTimeout(pending.timer);
        pendingConnects.delete(reqId);
        if (/auth|password|publickey|permission denied/i.test(errorMsg) && sessionId) {
          const authSet = authFailedListeners.get(sessionId);
          authSet?.forEach((cb) => {
            try {
              cb({ sessionId, message: errorMsg });
            } catch {}
          });
        }
        pending.reject(new Error(errorMsg));
        return;
      }
      if (sessionId) {
        const set = exitListeners.get(sessionId);
        set?.forEach((cb) => {
          try {
            cb({ sessionId, exitCode: 1, error: errorMsg, reason: 'error' });
          } catch {}
        });
      }
      return;
    }

    if (eventType === 'terminal_exit') {
      const sessionId = payload?.sessionId;
      if (sessionId) {
        sessionDecoders.delete(sessionId);
        const set = exitListeners.get(sessionId);
        set?.forEach((cb) => {
          try {
            cb({
              sessionId,
              exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : (payload.code ?? 0),
              error: payload.error,
            });
          } catch {}
        });
      }
      return;
    }

    if (eventType === 'sftp_transfer_event') {
      const tid = payload?.transferId;
      if (tid && payload?.type === 'progress' && sftpProgressCallbacks.has(tid)) {
        try {
          sftpProgressCallbacks.get(tid)!(
            Number(payload.transferred || 0),
            Number(payload.totalBytes || 0),
            Number(payload.speed || 0),
          );
        } catch {}
      }
      if (tid && (payload?.type === 'completed' || payload?.type === 'failed' || payload?.type === 'cancelled')) {
        sftpProgressCallbacks.delete(tid);
      }
      globalSftpTransferListeners.forEach((cb) => {
        try {
          cb(payload);
        } catch {}
      });
      return;
    }

    if (eventType === 'dialog:open-file-result') {
      const cbId = payload?.callbackId;
      if (cbId && pendingFilePickers.has(cbId)) {
        const resolver = pendingFilePickers.get(cbId)!;
        pendingFilePickers.delete(cbId);
        resolver({
          canceled: Boolean(payload.canceled),
          filePath: payload.filePath,
          fileName: payload.fileName,
          error: payload.error,
        });
      }
      return;
    }

    if (eventType === 'port_forward_runtime') {
      const tunnels = Array.isArray(payload?.tunnels) ? payload.tunnels : [];
      const snapshot = {
        revision: Date.now(),
        tunnels: tunnels.map((t: any) => ({
          ...t,
          ruleId: t.ruleId || t.tunnelId,
          ownerCount: 1,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        })),
      };
      portForwardRuntimeListeners.forEach((cb) => {
        try {
          cb({ type: 'SnapshotReplaced', snapshot });
        } catch {}
      });
      return;
    }

    if (eventType === 'port_forward_status') {
      const tunnelId = payload?.tunnelId;
      const status = payload?.status;
      const error = payload?.error;
      if (tunnelId && portForwardStatusListeners.has(tunnelId)) {
        portForwardStatusListeners.get(tunnelId)!.forEach((cb) => {
          try {
            cb(status, error);
          } catch {}
        });
      }
      portForwardRuntimeListeners.forEach((cb) => {
        try {
          cb({ type: 'TunnelUpdated', record: payload });
        } catch {}
      });
      return;
    }

    if (eventType === 'ai_stream_data') {
      const requestId = payload?.requestId;
      if (requestId && aiStreamDataListeners.has(requestId)) {
        aiStreamDataListeners.get(requestId)!.forEach((cb) => {
          try {
            cb(payload.data);
          } catch {}
        });
      }
      return;
    }

    if (eventType === 'ai_stream_end') {
      const requestId = payload?.requestId;
      if (requestId && aiStreamEndListeners.has(requestId)) {
        aiStreamEndListeners.get(requestId)!.forEach((cb) => {
          try {
            cb();
          } catch {}
        });
      }
      return;
    }

    if (eventType === 'ai_stream_error') {
      const requestId = payload?.requestId;
      if (requestId && aiStreamErrorListeners.has(requestId)) {
        aiStreamErrorListeners.get(requestId)!.forEach((cb) => {
          try {
            cb(payload.error || 'AI stream error');
          } catch {}
        });
      }
      return;
    }
  };

  // Monitor service state in JS (reconciles monitor panels and polls sshGetServerStats)
  let monitorEpoch = 1;
  const monitorRuntimeId = `mobile-monitor-${Date.now()}`;
  const monitorHostsMap = new Map<
    string,
    {
      id: string;
      historyId: string;
      options: any;
      sessionId: string;
      status: 'queued' | 'connecting' | 'live' | 'login' | 'error' | 'unsupported' | 'disconnected';
      stats: any;
      at: number;
      statsAt: number;
      points: Array<{ at: number; cpu: number | null; memUsed: number | null; netRxSpeed: number; netTxSpeed: number }>;
      timer?: number;
    }
  >();

  async function ensureMonitorHostSession(entry: any): Promise<void> {
    const native = getNative();
    if (!native || !entry.options?.hostname) {
      entry.status = 'unsupported';
      return;
    }
    try {
      entry.status = 'connecting';
      await new Promise<string>((resolve, reject) => {
        const reqId = nextReqId('mon-conn');
        const timer = window.setTimeout(() => {
          pendingConnects.delete(reqId);
          reject(new Error('Monitor SSH connection timeout'));
        }, 16000);
        pendingConnects.set(reqId, { sessionId: entry.sessionId, resolve, reject, timer });
        native.connectSshSession(
          reqId,
          JSON.stringify({
            ...entry.options,
            sessionId: entry.sessionId,
            cols: 80,
            rows: 24,
          }),
        );
      });
      entry.status = 'live';
    } catch {
      entry.status = 'login';
    }
  }

  async function sampleMonitorEntry(entry: any, intervalSec: number): Promise<void> {
    const native = getNative();
    if (!native) return;
    if (entry.status === 'queued' || entry.status === 'disconnected') {
      await ensureMonitorHostSession(entry);
    }
    if (entry.status !== 'live' && entry.status !== 'connecting') return;
    try {
      const res = await callNativeAsync((reqId) => {
        native.sshGetServerStats(reqId, entry.sessionId);
      }, 12000);
      if (res?.success && res.stats) {
        const now = Date.now();
        entry.status = 'live';
        entry.stats = res.stats;
        entry.at = now;
        entry.statsAt = now;
        entry.points.push({
          at: now,
          cpu: res.stats.cpu ?? 0,
          memUsed: res.stats.memUsed ?? 0,
          netRxSpeed: res.stats.netRxSpeed ?? 0,
          netTxSpeed: res.stats.netTxSpeed ?? 0,
        });
        if (entry.points.length > 60) entry.points.shift();
      } else {
        entry.status = 'error';
      }
    } catch {
      entry.status = 'error';
    }
    if (entry.timer) window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => {
      void sampleMonitorEntry(entry, intervalSec);
    }, Math.max(3, intervalSec) * 1000);
  }

  // Provider configs cached in JS for AI API key placeholder replacement
  let cachedAiProviders: any[] = [];
  let cloudSyncSessionPassword: string | null = null;

  function resolveAiRequestAuth(url: string, headers: Record<string, string> | undefined, providerId?: string) {
    const outHeaders: Record<string, string> = { ...(headers || {}) };
    let outUrl = url;
    if (providerId) {
      const provider = cachedAiProviders.find((p) => p.id === providerId);
      const rawKey = provider?.apiKey ? String(provider.apiKey) : '';
      if (rawKey) {
        for (const k of Object.keys(outHeaders)) {
          if (typeof outHeaders[k] === 'string') {
            outHeaders[k] = outHeaders[k].replace('__IPC_SECURED__', rawKey);
          }
        }
        if (outUrl.includes('__IPC_SECURED__')) {
          outUrl = outUrl.replace('__IPC_SECURED__', encodeURIComponent(rawKey));
        }
      }
    }
    if (outUrl.includes('__IPC_SECURED__') || Object.values(outHeaders).some(value => value.includes('__IPC_SECURED__'))) throw new Error('AI credential unavailable; sync providers first');
    return { url: outUrl, headers: outHeaders };
  }

  // Shell helper for System Manager (Processes, Docker, Tmux, Ports, Services, GPU)
  async function execOnSessionHelper(
    sessionId: string,
    command: string,
    timeoutMs = 12000,
    stdinData = '',
  ): Promise<{ success: boolean; stdout: string; stderr: string; code: number; error?: string }> {
    const native = getNative();
    if (!native) {
      return { success: false, stdout: '', stderr: '', code: 1, error: 'Native bridge unavailable' };
    }
    try {
      const res = await callNativeAsync(
        (reqId) => native.sshExecOnSession(reqId, sessionId, '', command, timeoutMs, stdinData),
        timeoutMs + 4000,
      );
      return {
        success: Boolean(res?.success),
        stdout: String(res?.stdout || ''),
        stderr: String(res?.stderr || ''),
        code: typeof res?.exitCode === 'number' ? res.exitCode : 0,
        error: res?.error,
      };
    } catch (err) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        code: 1,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Build the complete `window.netcatty` bridge implementation
  // Legacy renderer aliases may coexist; every declared desktop method remains checked.
  const bridge: NetcattyBridge & Record<string, unknown> = {
    // ── SSH / Terminal Sessions ──
    startSSHSession: async (options: NetcattySSHOptions): Promise<string> => {
      const native = getNative();
      const sessionId = options.sessionId || `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!native) {
        throw new Error('Android NativeBridge is not available');
      }
      sessionBacklog.delete(sessionId);
      return new Promise<string>((resolve, reject) => {
        const reqId = nextReqId('ssh-conn');
        const timer = window.setTimeout(() => {
          pendingConnects.delete(reqId);
          reject(new Error('SSH connection timed out (20s)'));
        }, 20000);
        pendingConnects.set(reqId, { sessionId, resolve, reject, timer });
        native.connectSshSession(
          reqId,
          JSON.stringify({
            ...options,
            sessionId,
            cols: options.cols || 80,
            rows: options.rows || 24,
          }),
        );
      });
    },

    testConnection: async (options: NetcattySSHOptions): Promise<string> => {
      const native = getNative();
      const sessionId = options.sessionId || `test-${Date.now()}`;
      if (!native) throw new Error('NativeBridge unavailable');
      const res = await callNativeAsync(
        (reqId) =>
          native.testSshConnection(
            reqId,
            JSON.stringify({
              ...options,
              sessionId,
            }),
          ),
        18000,
      );
      if (!res?.ok) {
        throw new Error(res?.error || 'SSH connection test failed');
      }
      return sessionId;
    },

    cancelTestConnection: unsupportedMobile,

    startTelnetSession: async (options): Promise<string> => {
      const native = getNative();
      const sessionId = options.sessionId || `telnet-${Date.now()}`;
      if (!native) throw new Error('NativeBridge unavailable');
      return new Promise<string>((resolve, reject) => {
        const reqId = nextReqId('tcp-conn');
        const timer = window.setTimeout(() => {
          pendingConnects.delete(reqId);
          reject(new Error('Telnet connection timed out'));
        }, 12000);
        pendingConnects.set(reqId, { sessionId, resolve, reject, timer });
        native.connectTcpSession(reqId, sessionId, options.hostname, options.port || 23);
      });
    },

    startMoshSession: unsupportedMobile,

    startEtSession: unsupportedMobile,

    startLocalSession: async (options): Promise<string> => {
      const native = getNative();
      const sessionId = options?.sessionId || `local-${Date.now()}`;
      if (!native) throw new Error('NativeBridge unavailable');
      return new Promise<string>((resolve, reject) => {
        const reqId = nextReqId('local-sh');
        const timer = window.setTimeout(() => {
          pendingConnects.delete(reqId);
          reject(new Error('Local shell start timed out'));
        }, 8000);
        pendingConnects.set(reqId, { sessionId, resolve, reject, timer });
        native.startLocalShell(reqId, sessionId, options?.cwd || '');
      });
    },

    startSerialSession: async (): Promise<string> => {
      throw new Error('Serial port requires desktop USB driver');
    },

    listSerialPorts: async () => [],

    getDefaultShell: async () => '/system/bin/sh',

    discoverShells: async () => [
      { id: 'sh', name: 'Android POSIX sh', command: '/system/bin/sh', icon: 'terminal', args: ['-i'] },
    ],

    validatePath: async (path: string) => {
      const native = getNative();
      const statStr = native?.statLocalFileSync(path);
      const stat = statStr ? JSON.parse(statStr) : null;
      return { exists: Boolean(stat), isFile: stat?.type === 'file', isDirectory: stat?.type === 'directory', isExecutable: false };
    },

    writeToSession: (sessionId: string, data: string, options?: any) => {
      const native = getNative();
      if (!native || !sessionId || !data) return;
      const lineDelayMs = Number(options?.lineDelayMs);
      if (Number.isFinite(lineDelayMs) && lineDelayMs > 0 && data.includes('\n')) {
        const lines = data.replace(/\r\n/g, '\n').split('\n');
        lines.forEach((line, idx) => {
          window.setTimeout(() => {
            const payload = idx < lines.length - 1 ? `${line}\r` : line;
            if (payload) {
              native.writeTerminalBytesB64(sessionId, utf8ToB64(payload));
            }
            if (options?.pasteRequestId) {
              pasteWriteListeners.forEach((cb) => {
                try {
                  cb({
                    requestId: options.pasteRequestId,
                    sessionId,
                    index: idx,
                    done: idx === lines.length - 1,
                  });
                } catch {}
              });
            }
          }, idx * lineDelayMs);
        });
        return;
      }
      native.writeTerminalBytesB64(sessionId, utf8ToB64(data));
      if (options?.pasteRequestId) {
        queueMicrotask(() => {
          pasteWriteListeners.forEach((cb) => {
            try {
              cb({
                requestId: options.pasteRequestId,
                sessionId,
                index: 0,
                done: true,
              });
            } catch {}
          });
        });
      }
    },

    notifySessionUserInput: () => {},

    onTerminalPasteWrite: (cb) => {
      pasteWriteListeners.add(cb);
      return () => pasteWriteListeners.delete(cb);
    },

    interruptSession: (sessionId: string, _trace?: any, options?: { cancelPendingWritesOnly?: boolean }) => {
      if (options?.cancelPendingWritesOnly) return;
      const native = getNative();
      if (native && sessionId) {
        native.writeTerminalBytesB64(sessionId, utf8ToB64('\x03'));
      }
    },

    resizeSession: (sessionId: string, cols: number, rows: number) => {
      const native = getNative();
      if (native && sessionId) {
        native.resizeSshPty(sessionId, cols, rows);
      }
    },

    clearSessionPtyBuffer: () => {},
    setSessionFlowPaused: () => {},
    setSessionFlowPausedAndWait: unsupportedMobile,
    acquireSessionFlowPauseLease: unsupportedMobile,
    waitSessionFlowPauseLease: unsupportedMobile,
    releaseSessionFlowPauseLease: unsupportedMobile,
    onTerminalOutputDrainRequest: () => () => {},
    respondTerminalOutputDrain: () => {},
    notifyTerminalSessionDisplayReady: () => {},
    ackSessionFlow: () => {},

    closeSession: (sessionId: string) => {
      const native = getNative();
      sessionBacklog.delete(sessionId);
      sessionDecoders.delete(sessionId);
      if (native && sessionId) {
        native.closeSession(sessionId);
      }
    },

    setSessionEncoding: async (_sessionId, encoding) => ({ ok: /^utf-?8$/i.test(encoding), encoding: 'utf-8' }),

    onSessionData: (sessionId: string, cb: (data: string, meta?: any) => void, options?: { replayBacklog?: boolean }) => {
      if (!dataListeners.has(sessionId)) {
        dataListeners.set(sessionId, new Set());
      }
      dataListeners.get(sessionId)!.add(cb);
      if (options?.replayBacklog && sessionBacklog.has(sessionId)) {
        const backlog = sessionBacklog.get(sessionId)!;
        sessionBacklog.delete(sessionId);
        if (backlog) {
          queueMicrotask(() => {
            try {
              cb(backlog, undefined);
            } catch {}
          });
        }
      }
      return () => {
        const set = dataListeners.get(sessionId);
        set?.delete(cb);
        if (set && set.size === 0) dataListeners.delete(sessionId);
      };
    },

    onSessionExit: (sessionId: string, cb: (payload: any) => void) => {
      if (!exitListeners.has(sessionId)) {
        exitListeners.set(sessionId, new Set());
      }
      exitListeners.get(sessionId)!.add(cb);
      return () => {
        const set = exitListeners.get(sessionId);
        set?.delete(cb);
        if (set && set.size === 0) exitListeners.delete(sessionId);
      };
    },

    onAuthFailed: (sessionId: string, cb: (payload: any) => void) => {
      if (!authFailedListeners.has(sessionId)) {
        authFailedListeners.set(sessionId, new Set());
      }
      authFailedListeners.get(sessionId)!.add(cb);
      return () => {
        authFailedListeners.get(sessionId)?.delete(cb);
      };
    },

    onTelnetAutoLoginComplete: () => () => {},
    onTelnetAutoLoginCancelled: () => () => {},
    onMoshSessionReady: () => () => {},
    onTelnetEchoMode: () => () => {},
    getTelnetEchoMode: unsupportedMobile,
    onZmodemEvent: () => () => {},
    cancelZmodem: () => {},
    onZmodemOverwriteRequest: () => () => {},
    respondZmodemOverwrite: () => {},
    onChainProgress: () => () => {},
    onConnectionReuseFallback: () => () => {},
    onSftpConnectionProgress: (cb) => {
      sftpProgressListeners.add(cb);
      return () => sftpProgressListeners.delete(cb);
    },
    onKeyboardInteractive: () => () => {},
    onKeyboardInteractiveCancelled: () => () => {},
    respondKeyboardInteractive: unsupportedMobile,
    onHostKeyVerification: () => () => {},
    respondHostKeyVerification: unsupportedMobile,
    onPassphraseRequest: () => () => {},
    respondPassphrase: unsupportedMobile,
    respondPassphraseSkip: unsupportedMobile,
    onPassphraseTimeout: () => () => {},
    onPassphraseCancelled: () => () => {},
    onPassphraseAuthFailed: () => () => {},
    onFidoPromptRequest: () => () => {},
    respondFidoPrompt: unsupportedMobile,
    onFidoPromptTimeout: () => () => {},
    onFidoPromptCancelled: () => () => {},

    // ── SSH Exec, CWD, Distro, Server Stats & Monitoring ──
    execCommand: async (options) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      try {
        const res = await callNativeAsync(
          (reqId) =>
            native.sshExecOnSession(
              reqId,
              '',
              JSON.stringify(options),
              options.command,
              options.timeout || 15000,
              '',
            ),
          (options.timeout || 15000) + 5000,
        );
        return {
          success: Boolean(res?.success),
          stdout: res?.stdout || '',
          stderr: res?.stderr || '',
          code: res?.exitCode ?? 0,
          error: res?.error,
        };
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    },

    getSessionPwd: async (sessionId: string) => {
      const res = await execOnSessionHelper(sessionId, 'pwd 2>/dev/null || echo ~', 5000);
      const cwd = res.stdout.trim().split(/\r?\n/)[0];
      if (res.success && cwd && cwd.startsWith('/')) {
        return { success: true, cwd };
      }
      return { success: false, error: res.error || 'Could not resolve cwd' };
    },

    getSessionRemoteInfo: async (sessionId: string) => {
      const native = getNative();
      if (!native) return { success: false };
      try {
        return JSON.parse(native.getSessionRemoteInfoSync(sessionId));
      } catch {
        return { success: false };
      }
    },

    getSessionDistroInfo: async (sessionId: string) => {
      const res = await execOnSessionHelper(
        sessionId,
        'cat /etc/os-release 2>/dev/null || uname -a',
        6000,
      );
      return {
        success: res.success,
        stdout: res.stdout,
        stderr: res.stderr,
        error: res.error,
      };
    },

    readRemoteHistory: async (sessionId: string, limit = 500) => {
      const safeLimit = Number.isFinite(limit) ? Math.min(2000, Math.max(50, Math.floor(limit))) : 500;
      const cmd = `tail -n ${safeLimit} ~/.bash_history 2>/dev/null || tail -n ${safeLimit} ~/.zsh_history 2>/dev/null || true`;
      const res = await execOnSessionHelper(sessionId, cmd, 8000);
      return {
        success: res.success,
        shell: 'bash',
        bash: res.stdout,
        zsh: '',
        fish: '',
      };
    },

    getServerStats: async (sessionId: string) => {
      const native = getNative();
      if (!native) return { success: false, error: 'NativeBridge unavailable' };
      try {
        return await callNativeAsync((reqId) => native.sshGetServerStats(reqId, sessionId), 12000);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    monitorUpdate: async (panels) => {
      const wantedIds = new Set<string>();
      for (const panel of panels || []) {
        const interval = panel.interval || 5;
        for (const h of panel.hosts || []) {
          wantedIds.add(h.id);
          if (!monitorHostsMap.has(h.id)) {
            const entry = {
              id: h.id,
              historyId: `hist-${h.id}-${Date.now()}`,
              options: h.options,
              sessionId: `mon-${h.id}`,
              status: (h.options?.hostname ? 'queued' : 'unsupported') as any,
              stats: null,
              at: 0,
              statsAt: 0,
              points: [],
            };
            monitorHostsMap.set(h.id, entry);
            if (h.options?.hostname) {
              void sampleMonitorEntry(entry, interval);
            }
          }
        }
      }
      for (const [id, entry] of monitorHostsMap.entries()) {
        if (!wantedIds.has(id)) {
          if (entry.timer) window.clearTimeout(entry.timer);
          getNative()?.closeSession(entry.sessionId);
          monitorHostsMap.delete(id);
        }
      }
      return bridge.monitorSnapshot!();
    },

    monitorSnapshot: async () => {
      const hosts: Record<string, any> = {};
      const activeSessions: string[] = [];
      for (const [id, entry] of monitorHostsMap.entries()) {
        hosts[id] = {
          historyId: entry.historyId,
          status: entry.status,
          at: entry.at,
          statsAt: entry.statsAt,
          stats: entry.stats,
          points: entry.points,
        };
        if (entry.status === 'live' || entry.status === 'connecting') {
          activeSessions.push(entry.sessionId);
        }
      }
      return {
        epoch: monitorEpoch,
        historyMode: 'replace',
        runtimeId: monitorRuntimeId,
        takenAt: Date.now(),
        activeSessions,
        running: ['main'],
        startedAt: { main: Date.now() },
        count: 1,
        hostCount: monitorHostsMap.size,
        hosts,
      };
    },

    monitorStopAll: async () => {
      monitorEpoch += 1;
      for (const entry of monitorHostsMap.values()) {
        if (entry.timer) window.clearTimeout(entry.timer);
        getNative()?.closeSession(entry.sessionId);
      }
      monitorHostsMap.clear();
    },

    monitorRetry: async (hostId: string) => {
      const entry = monitorHostsMap.get(hostId);
      if (entry) {
        entry.status = 'queued';
        void sampleMonitorEntry(entry, 5);
      }
    },

    // ── Keychain & SSH Agent ──
    generateKeyPair: async (options) => {
      const native = getNative();
      if (!native) return { success: false, error: 'NativeBridge unavailable' };
      try {
        const resStr = native.generateRealSshKey(
          options.type || 'ED25519',
          options.bits || 4096,
          options.comment || 'netcatty@android',
        );
        return JSON.parse(resStr);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    checkSshAgent: async () => ({ running: false, startupType: null, error: 'SSH agent unavailable on Android' }),
    getDefaultKeys: async () => [],
    readKnownHosts: async () => null,

    // ── Port Forwarding ──
    startPortForward: async (options: any) => {
      const native = getNative();
      if (!native) return { success: false, error: 'NativeBridge unavailable' };
      try {
        const normalized = {
          ...options,
          hostname: options?.hostname || options?.host || options?.sshHost || '',
          port: Number(options?.port || options?.sshPort || 22),
          bindAddress: options?.bindAddress || options?.localHost || '127.0.0.1',
          localPort: Number(options?.localPort ?? 8080),
          remoteHost: options?.remoteHost || '127.0.0.1',
          remotePort: Number(options?.remotePort ?? 80),
        };
        const res = await callNativeAsync(
          (reqId) => native.startSshPortForward(reqId, JSON.stringify(normalized)),
          20000,
        );
        return {
          success: Boolean(res?.success),
          tunnelId: res?.tunnelId || options.tunnelId,
          localPort: res?.localPort ?? normalized.localPort,
          error: res?.error,
        } as any;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        } as any;
      }
    },

    stopPortForward: async (tunnelId: string) => {
      getNative()?.stopSshPortForward(tunnelId);
      return { success: true, tunnelId };
    },

    getPortForwardStatus: async (tunnelId: string) => {
      const list = (await bridge.listPortForwards?.()) || [];
      const found = list.find((t: any) => t.tunnelId === tunnelId);
      return {
        tunnelId,
        type: found?.type as 'local' | 'remote' | 'dynamic' | undefined,
        status: (found?.status || 'inactive') as 'connecting' | 'active' | 'error' | 'inactive',
        error: found?.error,
      };
    },

    listPortForwards: async () => {
      const native = getNative();
      if (!native) return [];
      try {
        return JSON.parse(native.listPortForwardsSync());
      } catch {
        return [];
      }
    },

    getPortForwardSnapshot: async () => {
      const tunnels = (await bridge.listPortForwards?.()) || [];
      return {
        revision: Date.now(),
        tunnels: tunnels.map((t: any) => ({
          ...t,
          ruleId: (t as any).ruleId || t.tunnelId,
          ownerCount: 1,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        })),
      } as any;
    },

    subscribePortForward: async (tunnelId: string) => bridge.getPortForwardStatus!(tunnelId),
    subscribePortForwardRuntime: async () => bridge.getPortForwardSnapshot!(),
    unsubscribePortForwardRuntime: unsupportedMobile,
    stopAllPortForwards: async () => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      native.stopAllSshPortForwards();
    },
    stopPortForwardByRuleId: async (ruleOrPayload: any) => {
      const ruleId = typeof ruleOrPayload === 'string' ? ruleOrPayload : String(ruleOrPayload?.ruleId || '');
      const list = (await bridge.listPortForwards?.()) || [];
      let stopped = 0;
      for (const t of list) {
        if ((t as any).ruleId === ruleId || t.tunnelId === ruleId) {
          getNative()?.stopSshPortForward(t.tunnelId);
          stopped += 1;
        }
      }
      if (stopped === 0 && ruleId) {
        getNative()?.stopSshPortForward(ruleId);
      }
      return { success: true, stopped, failed: 0, errors: [] } as any;
    },
    onPortForwardStatus: (tunnelId: string, cb) => {
      if (!portForwardStatusListeners.has(tunnelId)) {
        portForwardStatusListeners.set(tunnelId, new Set());
      }
      portForwardStatusListeners.get(tunnelId)!.add(cb);
      return () => {
        portForwardStatusListeners.get(tunnelId)?.delete(cb);
      };
    },
    onPortForwardRuntime: (cb) => {
      portForwardRuntimeListeners.add(cb);
      return () => portForwardRuntimeListeners.delete(cb);
    },

    // ── SFTP Operations (Bidirectional; independent of cloud restore policy) ──
    openSftp: async (options: NetcattySSHOptions): Promise<string> => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const sftpId = `sftp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const res = await callNativeAsync(
        (reqId) =>
          native.sftpOpenSession(
            reqId,
            sftpId,
            options.sourceSessionId || '',
            JSON.stringify(options),
          ),
        18000,
      );
      if (!res?.ok) throw new Error(res?.error || 'Failed to open SFTP session');
      return sftpId;
    },

    openSftpForSession: async (sessionId: string, options?: NetcattySSHOptions): Promise<string> => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const sftpId = `${sessionId}-sftp-${Date.now()}`;
      const res = await callNativeAsync(
        (reqId) =>
          native.sftpOpenSession(
            reqId,
            sftpId,
            sessionId,
            JSON.stringify(options || {}),
          ),
        18000,
      );
      if (!res?.ok) throw new Error(res?.error || 'Failed to open SFTP for session');
      return sftpId;
    },

    listSftp: async (sftpId: string, path: string) => {
      const native = getNative();
      if (!native) return [];
      const res = await callNativeAsync(
        (reqId) => native.sftpList(reqId, sftpId, path || '.'),
        15000,
      );
      return res?.entries || [];
    },

    realpathSftp: async (sftpId: string, path: string) => {
      const native = getNative();
      if (!native) return path || '/';
      const res = await callNativeAsync(
        (reqId) => native.sftpHomeAndRealpath(reqId, sftpId, path || '.'),
        10000,
      );
      return res?.path || path || '/';
    },

    getSftpHomeDir: async (sftpId: string) => {
      const native = getNative();
      if (!native) return { success: true, homeDir: '/root' };
      try {
        const res = await callNativeAsync(
          (reqId) => native.sftpHomeAndRealpath(reqId, sftpId, '~'),
          10000,
        );
        return { success: true, homeDir: res?.path || '/root' };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    statSftp: async (sftpId: string, path: string) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const res = await callNativeAsync(
        (reqId) => native.sftpStat(reqId, sftpId, path, true),
        10000,
      );
      if (!res?.ok || !res.stat) throw new Error(res?.error || 'Stat failed');
      return res.stat;
    },

    lstatSftp: async (sftpId: string, path: string) => {
      const native = getNative();
      if (!native) return null;
      try {
        const res = await callNativeAsync(
          (reqId) => native.sftpStat(reqId, sftpId, path, false),
          10000,
        );
        if (!res?.ok || !res.stat) return null;
        return res.stat;
      } catch {
        return null;
      }
    },

    readSftp: async (sftpId: string, path: string) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const res = await callNativeAsync(
        (reqId) => native.sftpReadFile(reqId, sftpId, path, false),
        25000,
      );
      return String(res?.content ?? '');
    },

    readSftpBinary: async (sftpId: string, path: string) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const res = await callNativeAsync(
        (reqId) => native.sftpReadFile(reqId, sftpId, path, true),
        25000,
      );
      const bytes = b64ToUint8Array(res?.base64 || '');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },

    // SFTP is bidirectional; only cloud vault synchronization is pull-only.
    writeSftp: async (sftpId, path, content) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      await callNativeAsync((id) => native.sftpWriteFile(id, sftpId, path, content, false));
    },
    writeSftpBinary: async (sftpId, path, content) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      await callNativeAsync((id) => native.sftpWriteFile(id, sftpId, path, arrayBufferToB64(content), true));
    },
    mkdirSftp: async (sftpId, path) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      await callNativeAsync((id) => native.sftpMkdir(id, sftpId, path));
    },
    deleteSftp: async (sftpId, path) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      await callNativeAsync((id) => native.sftpDelete(id, sftpId, path));
    },
    renameSftp: async (sftpId, oldPath, newPath) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      await callNativeAsync((id) => native.sftpRename(id, sftpId, oldPath, newPath));
    },
    chmodSftp: async (sftpId, path, mode) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      if (!/^[0-7]{3,4}$/.test(mode)) throw new Error('Invalid octal permissions');
      await callNativeAsync((id) => native.sftpChmod(id, sftpId, path, mode));
    },
    startCompressedUpload: async (options) => ({
      compressionId: options.compressionId,
      success: false,
      error: 'Compressed tar upload unavailable on Android; falling back to standard SFTP transfer',
    }),
    cancelCompressedUpload: unsupportedMobile,
    pauseCompressedUpload: async () => ({ success: false }),
    resumeCompressedUpload: async () => ({ success: false }),
    checkCompressedUploadSupport: async () => ({
      supported: false,
      localTar: false,
      remoteTar: false,
    }),

    closeSftp: async (sftpId: string) => {
      const native = getNative();
      if (!native) return { success: false };
      const leaseCount = sftpLeases.get(sftpId)?.size || 0;
      if (leaseCount) { deferredSftpClose.add(sftpId); return { success: true, deferred: true, leaseCount }; }
      native.sftpCloseSession(sftpId);
      return { success: true };
    },
    retainSftpTransferSession: async (sftpId, leaseId) => {
      if (!getNative() || deferredSftpClose.has(sftpId)) return { success: false, reason: 'SFTP session unavailable or closing' };
      if (!sftpLeases.has(sftpId)) sftpLeases.set(sftpId, new Set());
      sftpLeases.get(sftpId)!.add(leaseId);
      return { success: true };
    },
    releaseSftpTransferSession: async (sftpId, leaseId) => {
      const leases = sftpLeases.get(sftpId);
      leases?.delete(leaseId);
      if (!leases?.size) {
        sftpLeases.delete(sftpId);
        if (deferredSftpClose.delete(sftpId)) getNative()?.sftpCloseSession(sftpId);
      }
      return { success: true };
    },

    startStreamTransfer: async (
      options: any,
      onProgress?: (transferred: number, totalBytes: number, speed: number) => void,
      onComplete?: () => void,
      onError?: (error: string) => void,
    ) => {
      const native = getNative();
      if (!native) {
        return { transferId: options.transferId, error: 'NativeBridge unavailable' };
      }
      try {
        const downloading = options.sourceType === 'sftp' && options.targetType === 'local';
        const uploading = options.sourceType === 'local' && options.targetType === 'sftp';
        if (!downloading && !uploading) return { transferId: options.transferId, error: 'Cross-server and local-to-local transfers are unsupported on Android' };

        // Case 3: SFTP -> Local Download
        if (!(downloading ? options.sourceSftpId : options.targetSftpId)) {
          return { transferId: options.transferId, error: 'SFTP source session unavailable' };
        }
        if (typeof onProgress === 'function') sftpProgressCallbacks.set(options.transferId, onProgress);
        const res = await callNativeAsync(
          (reqId) => {
            if (downloading) native.sftpStreamDownloadToLocal(reqId, options.transferId, options.sourceSftpId, options.sourcePath, options.targetPath);
            else native.sftpStreamUploadFromLocal(reqId, options.transferId, options.targetSftpId, options.sourcePath, options.targetPath);
          },
          600000,
          () => native.cancelSftpTransfer(options.transferId),
        );
        if (res?.error) {
          onError?.(res.error);
        } else if (!res?.cancelled) {
          onComplete?.();
        }
        return {
          transferId: options.transferId,
          totalBytes: res?.totalBytes,
          cancelled: res?.cancelled,
          error: res?.error,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        onError?.(error);
        return { transferId: options.transferId, error };
      } finally {
        if (options?.transferId) {
          sftpProgressCallbacks.delete(options.transferId);
        }
      }
    },

    cancelTransfer: async (transferId: string) => {
      getNative()?.cancelSftpTransfer(transferId);
    },
    clearPendingTransferCancel: unsupportedMobile,
    pauseTransfer: async () => ({ success: false, reason: 'Not supported on mobile' }),
    resumeTransfer: async () => ({ success: false, reason: 'Not supported on mobile' }),
    prioritizeTransfer: unsupportedMobile,
    setGlobalTransferConcurrency: unsupportedMobile,
    cleanupTransferArtifacts: unsupportedMobile,
    onGlobalSftpTransferEvent: (cb) => {
      globalSftpTransferListeners.add(cb);
      return () => globalSftpTransferListeners.delete(cb);
    },

    downloadSftpToTempWithProgress: async (sftpId, remotePath, fileName, _encoding, transferId) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const home = native.getHomeDirSync();
      const safeName = (fileName || remotePath.split('/').pop() || 'download.bin').split(/[\\/]/).pop() || 'download.bin';
      if (safeName === '.' || safeName === '..') throw new Error('Invalid download filename');
      const targetPath = `${home}/Downloads/${safeName}`;
      const tid = transferId || `dl-${Date.now()}`;
      const res = await callNativeAsync(
        (reqId) => native.sftpStreamDownloadToLocal(reqId, tid, sftpId, remotePath, targetPath),
        300000,
        () => native.cancelSftpTransfer(tid),
      );
      if (res?.error) throw new Error(res.error);
      return { localPath: targetPath, cancelled: Boolean(res?.cancelled) };
    },

    // ── Local Sandbox Filesystem ──
    getHomeDir: async () => {
      return getNative()?.getHomeDirSync() || '/data/user/0/de.newaii.netcatty/files';
    },
    listDrives: async () => ['/'],
    getSystemInfo: async () => {
      const native = getNative();
      if (!native) return { username: 'android', hostname: 'netcatty-mobile' };
      try {
        const info = JSON.parse(native.getDeviceSysInfo());
        return { username: 'android', hostname: info.model || 'android-device' };
      } catch {
        return { username: 'android', hostname: 'netcatty-mobile' };
      }
    },
    listLocalDir: async (path: string) => {
      const native = getNative();
      if (!native) return [];
      try {
        return JSON.parse(native.listLocalFiles(path || '~'));
      } catch {
        return [];
      }
    },
    statLocal: async (path: string) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const s = native.statLocalFileSync(path);
      if (!s) throw new Error(`File not found: ${path}`);
      return JSON.parse(s);
    },
    lstatLocal: async (path: string) => {
      return bridge.statLocal!(path);
    },
    realpathLocal: async (path: string) => {
      if (!path || path === '~' || path === '.') {
        return bridge.getHomeDir!();
      }
      return path;
    },
    readLocalFile: async (path: string, options?: { maxBytes?: number }) => {
      const native = getNative();
      if (!native) return new ArrayBuffer(0);
      const b64 = native.readLocalFileB64(path, options?.maxBytes || 0);
      if (!b64) return new ArrayBuffer(0);
      const bytes = b64ToUint8Array(b64);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
    writeLocalFile: async (path: string, content: ArrayBuffer) => {
      const native = getNative();
      if (!native || !native.writeLocalFileB64(path, arrayBufferToB64(content))) throw new Error('Local file write failed');
    },
    deleteLocalFile: async (path: string) => {
      if (!getNative()?.deleteLocalFile(path)) throw new Error('Local filesystem operation failed');
    },
    renameLocalFile: async (oldPath: string, newPath: string) => {
      if (!getNative()?.renameLocalFile(oldPath, newPath)) throw new Error('Local filesystem operation failed');
    },
    mkdirLocal: async (path: string) => {
      if (!getNative()?.mkdirLocal(path)) throw new Error('Local filesystem operation failed');
    },
    listLocalTree: async () => [],
    cancelLocalTreeScan: async () => {},

    // ── Cloud Sync (Strictly PULL-ONLY / Read-Only on Remote Cloud) ──
    cloudSyncSetSessionPassword: async (password: string) => {
      cloudSyncSessionPassword = password;
      return true;
    },
    cloudSyncGetSessionPassword: async () => cloudSyncSessionPassword,
    cloudSyncClearSessionPassword: async () => {
      cloudSyncSessionPassword = null;
      return true;
    },
    onCloudSyncSessionPasswordAvailable: () => () => {},

    githubStartDeviceFlow: async (options) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const body = new URLSearchParams({
        client_id: options?.clientId || '',
        scope: options?.scope || 'gist read:user',
      }).toString();
      const res = await callNativeAsync((reqId) =>
        native.httpFetchAsync(
          reqId,
          'https://github.com/login/device/code',
          'POST',
          JSON.stringify({
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
          body,
          false,
        ),
      );
      if (!res?.ok) throw new Error(`GitHub device flow failed: ${res?.status}`);
      const data = JSON.parse(res.data);
      return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        expiresAt: Date.now() + (data.expires_in || 900) * 1000,
        interval: data.interval || 5,
      };
    },

    githubPollDeviceFlowToken: async (options) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const body = new URLSearchParams({
        client_id: options?.clientId || '',
        device_code: options.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString();
      const res = await callNativeAsync((reqId) =>
        native.httpFetchAsync(
          reqId,
          'https://github.com/login/oauth/access_token',
          'POST',
          JSON.stringify({
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
          body,
          false,
        ),
      );
      return JSON.parse(res?.data || '{}');
    },

    githubCancelDeviceFlowPoll: async () => {},

    githubDownloadGistRawContent: async (options) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const res = await callNativeAsync((reqId) =>
        native.httpFetchAsync(
          reqId,
          options.rawUrl,
          'GET',
          JSON.stringify({
            Authorization: 'Bearer ' + String(options.accessToken || ''),
            Accept: 'application/vnd.github.raw',
          }),
          '',
          false,
        ),
      );
      if (!res?.ok) throw new Error(`Failed to download gist raw content: ${res?.status}`);
      return String(res.data || '');
    },

    cloudSyncWebdavInitialize: async (config) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const rawEndpoint = String(config.endpoint || '').trim();
      const normalized = /^https?:\/\//i.test(rawEndpoint) ? rawEndpoint : `https://${rawEndpoint}`;
      const endpoint = normalized.replace(/\/+$/, '');
      const url = endpoint.endsWith('.json') ? endpoint : `${endpoint}/netcatty-vault.json`;
      const headers: Record<string, string> = {
        Depth: '0',
        Accept: 'application/xml, text/xml, */*',
      };
      if (config.authType === 'token' && config.token) {
        headers.Authorization = `Bearer ${config.token}`;
      } else if (config.username || config.password) {
        headers.Authorization = `Basic ${utf8ToB64(`${config.username || ''}:${config.password || ''}`)}`;
      }
      const res = await callNativeAsync((reqId) =>
        native.httpFetchAsync(
          reqId,
          url,
          'PROPFIND',
          JSON.stringify(headers),
          '',
          Boolean(config.allowInsecure),
        ),
      );
      if (res?.status === 401 || res?.status === 403) {
        throw new Error(`WebDAV authentication failed (HTTP ${res.status})`);
      }
      if (!res?.status || (res.status >= 500 && res.status !== 501)) {
        throw new Error(res?.error || `WebDAV connection failed (HTTP ${res?.status || 0})`);
      }
      return { resourceId: '/netcatty-vault.json' };
    },
    cloudSyncWebdavDownload: async (config) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const rawEndpoint = String(config.endpoint || '').trim();
      const normalized = /^https?:\/\//i.test(rawEndpoint) ? rawEndpoint : `https://${rawEndpoint}`;
      const endpoint = normalized.replace(/\/+$/, '');
      const url = endpoint.endsWith('.json') ? endpoint : `${endpoint}/netcatty-vault.json`;
      const headers: Record<string, string> = {
        Accept: 'application/json, text/plain, */*',
      };
      if (config.authType === 'token' && config.token) {
        headers.Authorization = `Bearer ${config.token}`;
      } else if (config.username || config.password) {
        headers.Authorization = `Basic ${utf8ToB64(`${config.username || ''}:${config.password || ''}`)}`;
      }
      const res = await callNativeAsync((reqId) =>
        native.httpFetchAsync(
          reqId,
          url,
          'GET',
          JSON.stringify(headers),
          '',
          Boolean(config.allowInsecure),
        ),
      );
      if (res?.status === 404) return { syncedFile: null };
      if (!res?.ok) throw new Error(`WebDAV pull failed: HTTP ${res?.status}`);
      const text = String(res.data || '').trim();
      return { syncedFile: text ? JSON.parse(text) : null };
    },
    // STRICT PULL-ONLY: WebDAV upload & delete are no-op / blocked on mobile
    cloudSyncWebdavUpload: async () => {
      throw new Error('手机端已锁定「只下拉同步，不上传同步」，禁止覆盖云端 WebDAV 数据');
    },
    cloudSyncWebdavDelete: async () => {
      throw new Error('手机端已锁定「只下拉同步，不上传同步」，禁止删除云端 WebDAV 数据');
    },

    cloudSyncS3Initialize: async (config) => {
      const native = getNative();
      const prefix = String(config.prefix || '').trim().replace(/^\/+|\/+$/g, '');
      const key = prefix ? `${prefix}/netcatty-vault.json` : 'netcatty-vault.json';
      if (!native) throw new Error('NativeBridge unavailable');
      const signed = await buildAwsSigV4SignedRequest(config, 'HEAD', key);
      const res = await callNativeAsync((reqId) =>
        native.httpFetchAsync(
          reqId,
          signed.url,
          'HEAD',
          JSON.stringify(signed.headers),
          '',
          Boolean(config.allowInsecure),
        ),
      );
      if (res?.status === 401 || res?.status === 403) {
        throw new Error(`S3 access denied (HTTP ${res.status})`);
      }
      if (!res?.status || res.status >= 500) {
        throw new Error(res?.error || `S3 connection failed (HTTP ${res?.status || 0})`);
      }
      return { resourceId: key };
    },
    cloudSyncS3Download: async (config) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const prefix = String(config.prefix || '').trim().replace(/^\/+|\/+$/g, '');
      const key = prefix ? `${prefix}/netcatty-vault.json` : 'netcatty-vault.json';
      const signed = await buildAwsSigV4SignedRequest(config, 'GET', key);
      const res = await callNativeAsync((reqId) =>
        native.httpFetchAsync(
          reqId,
          signed.url,
          'GET',
          JSON.stringify(signed.headers),
          '',
          Boolean(config.allowInsecure),
        ),
      );
      if (res?.status === 404) return { syncedFile: null };
      if (!res?.ok) throw new Error(`S3 pull failed: HTTP ${res?.status}`);
      return { syncedFile: res.data ? JSON.parse(res.data) : null };
    },
    cloudSyncS3Upload: async () => {
      throw new Error('手机端已锁定「只下拉同步，不上传同步」，禁止上传覆盖 S3 云端数据');
    },
    cloudSyncS3Delete: async () => {
      throw new Error('手机端已锁定「只下拉同步，不上传同步」，禁止删除 S3 云端数据');
    },

    // ── System Manager (Processes, Tmux, Docker, Ports, Services) ──
    probeSystemCapabilities: async (sessionId: string) => {
      const script = [
        'printf "__NC_OS__=%s\\n" "$(uname -s 2>/dev/null)"',
        'command -v tmux >/dev/null 2>&1 && echo "__NC_TMUX__=1"',
        'command -v docker >/dev/null 2>&1 && echo "__NC_DOCKER__=1"',
        'command -v podman >/dev/null 2>&1 && echo "__NC_PODMAN__=1"',
        'command -v kubectl >/dev/null 2>&1 && echo "__NC_KUBECTL__=1"',
        'command -v nvidia-smi >/dev/null 2>&1 && echo "__NC_NVIDIA_SMI__=1"',
        'command -v ss >/dev/null 2>&1 && echo "__NC_SS__=1"',
        'command -v netstat >/dev/null 2>&1 && echo "__NC_NETSTAT__=1"',
        'command -v lsof >/dev/null 2>&1 && echo "__NC_LSOF__=1"',
        'command -v systemctl >/dev/null 2>&1 && echo "__NC_SYSTEMCTL__=1"',
      ].join('; ');
      const res = await execOnSessionHelper(sessionId, script, 8000);
      if (!res.success) return { success: false, error: res.error };
      const out = res.stdout;
      return {
        success: true,
        capabilities: {
          targetOs: /darwin/i.test(out) ? 'darwin' : 'linux',
          hasTmux: out.includes('__NC_TMUX__=1'),
          hasDocker: out.includes('__NC_DOCKER__=1'),
          hasPodman: out.includes('__NC_PODMAN__=1'),
          hasNerdctl: false,
          hasKubectl: out.includes('__NC_KUBECTL__=1'),
          hasNvidiaSmi: out.includes('__NC_NVIDIA_SMI__=1'),
          hasNpuSmi: false,
          hasSs: out.includes('__NC_SS__=1'),
          hasNetstat: out.includes('__NC_NETSTAT__=1'),
          hasLsof: out.includes('__NC_LSOF__=1'),
          hasSystemctl: out.includes('__NC_SYSTEMCTL__=1'),
          probedAt: Date.now(),
        },
      };
    },

    listSystemProcesses: async (sessionId: string) => {
      const cmd =
        'ps -eo pid= -o ppid= -o user= -o stat= -o pcpu= -o pmem= -o rss= -o vsz= -o etime= -o args= 2>/dev/null | head -n 200';
      const res = await execOnSessionHelper(sessionId, cmd, 10000);
      if (!res.success) return { success: false, error: res.error };
      const processes: any[] = [];
      for (const line of res.stdout.split(/\r?\n/)) {
        const m = line
          .trim()
          .match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
        if (m) {
          processes.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            user: m[3],
            stat: m[4],
            cpuPercent: Number(m[5]),
            memPercent: Number(m[6]),
            rssKb: Number(m[7]),
            vszKb: Number(m[8]),
            elapsed: m[9],
            command: m[10],
          });
        }
      }
      return { success: true, processes };
    },

    signalSystemProcess: async ({ sessionId, pid, signal = 'TERM' }) => {
      if (!['TERM', 'KILL', 'INT', 'HUP', 'QUIT', 'STOP', 'CONT', 'USR1', 'USR2'].includes(signal) || !Number.isSafeInteger(pid) || pid <= 1) return { success: false, error: 'Invalid process or signal' };
      const res = await execOnSessionHelper(sessionId, `kill -s ${signal} ${pid}`, 5000);
      return { success: res.success && res.code === 0, code: res.code, error: res.stderr || res.error };
    },

    setupOsc7Tracking: async (sessionId: string, command: string) => {
      const res = await execOnSessionHelper(sessionId, command, 8000);
      return { success: res.success, stdout: res.stdout, stderr: res.stderr, code: res.code };
    },

    listDockerContainers: async (sessionId: string, runtime = 'docker') => {
      const bin = runtime === 'podman' ? 'podman' : 'docker';
      const res = await execOnSessionHelper(sessionId, `${bin} ps -a --format '{{json .}}'`, 10000);
      if (!res.success) return { success: false, error: res.stderr || res.error };
      const containers: any[] = [];
      for (const line of res.stdout.split(/\r?\n/)) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        try {
          const row = JSON.parse(t);
          containers.push({
            id: row.ID || row.Id || '',
            name: String(row.Names || row.Name || '').replace(/^\//, ''),
            image: row.Image || '',
            status: row.Status || row.State || '',
            state: row.State || '',
            ports: row.Ports || '',
            createdAt: row.CreatedAt || '',
          });
        } catch {}
      }
      return { success: true, containers };
    },

    listDockerImages: async (sessionId: string, runtime = 'docker') => {
      const bin = runtime === 'podman' ? 'podman' : 'docker';
      const res = await execOnSessionHelper(sessionId, `${bin} images --format '{{json .}}'`, 10000);
      if (!res.success) return { success: false, error: res.stderr || res.error };
      const images: any[] = [];
      for (const line of res.stdout.split(/\r?\n/)) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        try {
          const row = JSON.parse(t);
          images.push({
            id: row.ID || row.Id || '',
            repository: row.Repository || '',
            tag: row.Tag || '',
            size: row.Size || '',
            createdAt: row.CreatedAt || row.CreatedSince || '',
            name: `${row.Repository || ''}:${row.Tag || ''}`,
          });
        } catch {}
      }
      return { success: true, images };
    },

    getDockerStats: async ({ sessionId, runtime = 'docker' }) => {
      const bin = runtime === 'podman' ? 'podman' : 'docker';
      const res = await execOnSessionHelper(
        sessionId,
        `${bin} stats --no-stream --format '{{json .}}'`,
        12000,
      );
      if (!res.success) return { success: false, error: res.stderr || res.error };
      const stats: any[] = [];
      for (const line of res.stdout.split(/\r?\n/)) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        try {
          const row = JSON.parse(t);
          stats.push({
            id: row.ID || row.Container || '',
            name: row.Name || '',
            cpuPercent: parseFloat(String(row.CPUPerc || '0').replace('%', '')) || 0,
            memUsage: row.MemUsage || '',
            memPercent: parseFloat(String(row.MemPerc || '0').replace('%', '')) || 0,
            netIO: row.NetIO || '',
            blockIO: row.BlockIO || '',
            pids: Number(row.PIDs || 0),
          });
        } catch {}
      }
      return { success: true, stats };
    },

    dockerAction: async ({ sessionId, containerId, action, runtime = 'docker' }) => {
      const bin = runtime === 'podman' ? 'podman' : 'docker';
      if (!['start', 'stop', 'restart', 'pause', 'unpause', 'rm'].includes(action) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerId)) return { success: false, error: 'Unsupported container action or invalid ID' };
      const cmd = action === 'rm' ? `${bin} rm -f -- ${shellQuote(containerId)}` : `${bin} ${action} -- ${shellQuote(containerId)}`;
      const res = await execOnSessionHelper(sessionId, cmd, 12000);
      return { success: res.success && res.code === 0, error: res.stderr || res.error };
    },

    listListeningPorts: async (sessionId: string) => {
      const res = await execOnSessionHelper(sessionId, 'ss -H -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null', 10000);
      if (!res.success) return { success: false, error: res.error };
      const ports: any[] = [];
      for (const line of res.stdout.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5 || !/^(tcp|udp)/i.test(parts[0])) continue;
        const proto = parts[0].toLowerCase();
        const local = parts[4]?.includes(':') ? parts[4] : parts[3] || '';
        const lastColon = local.lastIndexOf(':');
        if (lastColon < 0) continue;
        const port = Number(local.slice(lastColon + 1));
        if (!Number.isFinite(port)) continue;
        const addr = local.slice(0, lastColon) || '*';
        const procMatch = line.match(/\("([^"]+)",pid=(\d+)/) || line.match(/(\d+)\/(\S+)/);
        const pid = procMatch ? Number(procMatch[2] && /^\d+$/.test(procMatch[2]) ? procMatch[2] : procMatch[1]) : null;
        const processName = procMatch ? (procMatch[2] && !/^\d+$/.test(procMatch[2]) ? procMatch[2] : procMatch[1]) : '';
        ports.push({
          id: `${proto}|${addr}|${port}|${pid || '-'}`,
          protocol: proto,
          address: addr,
          port,
          pid,
          processName,
        });
      }
      return { success: true, ports };
    },

    listSystemServices: async (sessionId: string) => {
      const res = await execOnSessionHelper(
        sessionId,
        'systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null | head -n 150',
        12000,
      );
      if (!res.success) return { success: false, error: res.error };
      const units: any[] = [];
      for (const line of res.stdout.split(/\r?\n/)) {
        const m = line.trim().match(/^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
        if (m) {
          units.push({
            name: m[1],
            loadState: m[2],
            activeState: m[3],
            subState: m[4],
            description: m[5] || '',
            scope: 'system',
          });
        }
      }
      return { success: true, units };
    },

    systemServiceAction: async ({ sessionId, unitName, action }) => {
      if (!['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'reset-failed'].includes(action) || !/^[a-zA-Z0-9][a-zA-Z0-9_.@:\x5c-]*\.service$/.test(unitName)) return { success: false, error: 'Invalid service action or unit' };
      const res = await execOnSessionHelper(sessionId, `systemctl ${action} -- ${shellQuote(unitName)}`, 15000);
      return { success: res.success && res.code === 0, error: res.stderr || res.error };
    },

    listTmuxSessions: async (sessionId: string) => {
      const sep = '<<<NC_SEP>>>';
      const fmt = [
        '#{session_id}',
        '#{session_name}',
        '#{session_windows}',
        '#{session_attached}',
        '#{session_created}',
        '#{session_activity}',
      ].join(sep);
      const res = await execOnSessionHelper(
        sessionId,
        `tmux list-sessions -F '${fmt}' 2>/dev/null || true`,
        8000,
      );
      if (!res.success) return { success: false, error: res.error, sessions: [] } as any;
      const sessions = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [id = '', name = '', windows = '1', attached = '0', created = '0', activity = '0'] =
            line.split(sep);
          return {
            id,
            name,
            windows: Number(windows) || 1,
            attached: Number(attached) || 0,
            isAttached: Number(attached) > 0,
            createdAt: (Number(created) || 0) * 1000,
            lastActivityAt: (Number(activity) || 0) * 1000,
          };
        })
        .filter((s) => Boolean(s.name));
      return { success: true, sessions } as any;
    },

    createTmuxSession: async (options: any) => {
      const sessionId = String(options?.sessionId || '');
      const rawName = String(options?.name || 'main').replace(/[^a-zA-Z0-9_.-]/g, '_');
      const res = await execOnSessionHelper(sessionId, `tmux new-session -d -s '${rawName}'`, 8000);
      return { success: res.success && res.code === 0, name: rawName, error: res.stderr || res.error } as any;
    },

    listTmuxWindows: async (options: any) => {
      const sessionId = String(options?.sessionId || '');
      const target = String(options?.sessionName || options?.target || '');
      const sep = '<<<NC_SEP>>>';
      const fmt = [
        '#{window_id}',
        '#{window_index}',
        '#{window_name}',
        '#{window_active}',
        '#{window_panes}',
        '#{pane_current_command}',
      ].join(sep);
      const targetArg = target ? `-t '${target.replace(/'/g, "'\\''")}'` : '-a';
      const res = await execOnSessionHelper(
        sessionId,
        `tmux list-windows ${targetArg} -F '${fmt}' 2>/dev/null || true`,
        8000,
      );
      if (!res.success) return { success: false, error: res.error, windows: [] } as any;
      const windows = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [id = '', index = '0', name = '', active = '0', panes = '1', currentCommand = ''] =
            line.split(sep);
          return {
            id,
            index: Number(index) || 0,
            name,
            active: active === '1',
            panes: Number(panes) || 1,
            currentCommand,
          };
        });
      return { success: true, windows } as any;
    },

    listTmuxPanes: async (options: any) => {
      const sessionId = String(options?.sessionId || '');
      const target = String(options?.target || options?.sessionName || '');
      const sep = '<<<NC_SEP>>>';
      const fmt = [
        '#{pane_id}',
        '#{pane_index}',
        '#{pane_active}',
        '#{pane_width}',
        '#{pane_height}',
        '#{pane_current_command}',
        '#{pane_current_path}',
        '#{pane_pid}',
      ].join(sep);
      const targetArg = target ? `-t '${target.replace(/'/g, "'\\''")}'` : '-a';
      const res = await execOnSessionHelper(
        sessionId,
        `tmux list-panes ${targetArg} -F '${fmt}' 2>/dev/null || true`,
        8000,
      );
      if (!res.success) return { success: false, error: res.error, panes: [] } as any;
      const panes = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [id = '', index = '0', active = '0', width = '80', height = '24', cmd = '', cwd = '', pid = '0'] =
            line.split(sep);
          return {
            id,
            index: Number(index) || 0,
            active: active === '1',
            width: Number(width) || 80,
            height: Number(height) || 24,
            currentCommand: cmd,
            currentPath: cwd,
            pid: Number(pid) || 0,
          };
        });
      return { success: true, panes } as any;
    },

    listTmuxClients: async (options: any) => {
      const sessionId = String(options?.sessionId || '');
      const sep = '<<<NC_SEP>>>';
      const fmt = ['#{client_name}', '#{client_session}', '#{client_width}', '#{client_height}', '#{client_termname}'].join(sep);
      const res = await execOnSessionHelper(
        sessionId,
        `tmux list-clients -F '${fmt}' 2>/dev/null || true`,
        8000,
      );
      if (!res.success) return { success: false, error: res.error, clients: [] } as any;
      const clients = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [name = '', session = '', width = '80', height = '24', termName = ''] = line.split(sep);
          return { name, session, width: Number(width) || 80, height: Number(height) || 24, termName };
        });
      return { success: true, clients } as any;
    },

    tmuxAction: async (options: any) => {
      const sessionId = String(options?.sessionId || '');
      const action = String(options?.action || '');
      const target = String(options?.target || options?.sessionName || '').replace(/'/g, "'\\''");
      const newName = String(options?.newName || options?.name || '').replace(/'/g, "'\\''");
      let cmd = '';
      if (action === 'kill-session') cmd = `tmux kill-session -t '${target}'`;
      else if (action === 'rename-session') cmd = `tmux rename-session -t '${target}' '${newName}'`;
      else if (action === 'kill-window') cmd = `tmux kill-window -t '${target}'`;
      else if (action === 'kill-pane') cmd = `tmux kill-pane -t '${target}'`;
      else if (action === 'detach-client') cmd = `tmux detach-client -t '${target}'`;
      else return { success: false, error: `Unsupported tmux action: ${action}` } as any;
      const res = await execOnSessionHelper(sessionId, cmd, 8000);
      return { success: res.success && res.code === 0, error: res.stderr || res.error } as any;
    },

    listAccelerators: async (sessionId: string) => {
      const cmd = [
        'nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,driver_version --format=csv,noheader,nounits 2>/dev/null || true',
      ].join('; ');
      const res = await execOnSessionHelper(sessionId, cmd, 10000);
      if (!res.success) return { success: false, error: res.error, devices: [], processes: [] } as any;
      const devices: any[] = [];
      for (const line of res.stdout.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const cols = t.split(',').map((s) => s.trim());
        if (cols.length >= 6) {
          const memUsedMiB = parseFloat(cols[4]) || 0;
          const memTotalMiB = parseFloat(cols[5]) || 0;
          devices.push({
            vendor: 'nvidia',
            index: Number(cols[0]) || 0,
            uuid: cols[1] || `gpu-${cols[0]}`,
            name: cols[2] || 'NVIDIA GPU',
            utilizationPercent: parseFloat(cols[3]) || 0,
            memoryUsedBytes: Math.round(memUsedMiB * 1024 * 1024),
            memoryTotalBytes: Math.round(memTotalMiB * 1024 * 1024),
            memoryPercent: memTotalMiB > 0 ? Math.round((memUsedMiB / memTotalMiB) * 1000) / 10 : 0,
            temperatureC: parseFloat(cols[6]) || null,
            powerDrawW: parseFloat(cols[7]) || null,
            powerLimitW: parseFloat(cols[8]) || null,
            fanSpeedPercent: parseFloat(cols[9]) || null,
            driverVersion: cols[10] || '',
          });
        }
      }
      return { success: true, devices, processes: [] } as any;
    },

    dockerInspect: async (options: any) => {
      const bin = options?.runtime === 'podman' ? 'podman' : 'docker';
      const id = String(options?.containerId || options?.id || '').replace(/[^a-zA-Z0-9_.:-]/g, '');
      const res = await execOnSessionHelper(options?.sessionId, `${bin} inspect ${id}`, 10000);
      if (!res.success) return { success: false, error: res.stderr || res.error } as any;
      try {
        const arr = JSON.parse(res.stdout);
        const info = Array.isArray(arr) ? arr[0] : arr;
        return {
          success: true,
          inspect: info
            ? {
                id: info.Id,
                name: info.Name,
                image: info.Config?.Image,
                state: info.State,
                network: info.NetworkSettings,
                mounts: info.Mounts,
                env: info.Config?.Env,
                labels: info.Config?.Labels,
                raw: info,
              }
            : null,
        } as any;
      } catch {
        return { success: true, raw: res.stdout } as any;
      }
    },

    dockerImageInspect: async (options: any) => {
      const bin = options?.runtime === 'podman' ? 'podman' : 'docker';
      const id = String(options?.imageId || options?.id || '').replace(/[^a-zA-Z0-9_./:-]/g, '');
      const res = await execOnSessionHelper(options?.sessionId, `${bin} image inspect ${id}`, 10000);
      if (!res.success) return { success: false, error: res.stderr || res.error } as any;
      try {
        const arr = JSON.parse(res.stdout);
        const info = Array.isArray(arr) ? arr[0] : arr;
        return { success: true, inspect: info } as any;
      } catch {
        return { success: true, raw: res.stdout } as any;
      }
    },

    dockerImageAction: async (options: any) => {
      const bin = options?.runtime === 'podman' ? 'podman' : 'docker';
      const id = String(options?.imageId || options?.id || '').replace(/[^a-zA-Z0-9_./:-]/g, '');
      const action = String(options?.action || 'rm');
      if (!['rm', 'rmi'].includes(action) || !id || id.startsWith('-')) return { success: false, error: 'Unsupported image action' };
      const cmd = `${bin} rmi -f -- ${shellQuote(id)}`;
      const res = await execOnSessionHelper(options?.sessionId, cmd, 15000);
      return { success: res.success && res.code === 0, error: res.stderr || res.error } as any;
    },

    kubectl: unsupportedMobile,

    // ── Window Controls, Settings Overlay & System UI ──
    windowMinimize: async () => {},
    windowMaximize: async () => false,
    windowClose: async () => {},
    windowIsMaximized: async () => false,
    windowIsFullscreen: async () => true,
    windowFocus: async () => true,
    setTerminalKeyboardFocus: () => {},
    setWindowTitle: async (title: string) => { document.title = title; return true; },
    onWindowFullScreenChanged: () => () => {},
    onWindowShown: () => () => {},
    onWindowFocusRequested: () => () => {},
    onWindowWillHide: () => () => {},
    onWindowCommandCloseRequested: () => () => {},

    openSettingsWindow: async () => {
      if (window.__netcattyOpenMobileSettings) {
        window.__netcattyOpenMobileSettings();
      } else {
        window.dispatchEvent(new CustomEvent('netcatty:mobile:open-settings'));
      }
      return true;
    },

    closeSettingsWindow: async () => {
      if (window.__netcattyCloseMobileSettings) {
        window.__netcattyCloseMobileSettings();
      } else {
        window.dispatchEvent(new CustomEvent('netcatty:mobile:close-settings'));
      }
    },

    notifySettingsChanged: (payload) => {
      settingsChangedListeners.forEach((cb) => {
        try {
          cb(payload);
        } catch {}
      });
    },

    onSettingsChanged: (cb) => {
      settingsChangedListeners.add(cb);
      return () => settingsChangedListeners.delete(cb);
    },

    setTheme: async (theme) => {
      const hex = theme === 'light' ? '#f8fafc' : '#090d16';
      getNative()?.setStatusBarColorHex(hex);
      return Boolean(getNative());
    },

    setBackgroundColor: async (color: string) => {
      if (color && color.startsWith('#')) {
        getNative()?.setStatusBarColorHex(color);
      }
      return Boolean(getNative());
    },

    setWindowOpacity: async () => false,
    setWindowBackgroundBlur: async () => false,
    setAppIconVariant: async () => false,
    setLanguage: async () => false,
    onLanguageChanged: () => () => {},

    openExternalUrl: async (url: string) => {
      const native = getNative();
      if (native) {
        native.openExternalUrl(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },

    openExternal: async (url: string) => {
      const native = getNative();
      if (native) {
        native.openExternalUrl(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },

    openPath: async () => ({ success: false, error: 'Unsupported on Android' }),

    getAppInfo: async () => ({
      name: 'Netcatty Mate Mobile',
      version: '3.1.0',
      platform: 'android',
      arch: 'arm64-v8a',
      electron: 'Android WebView + JSch 0.2.21',
      chrome: navigator.userAgent,
      node: 'JSch-0.2.21/BC-1.79',
      v8: 'Native',
      osVersion: 'Android',
      userDataPath: getNative()?.getHomeDirSync() || '/data/user/0/de.newaii.netcatty/files',
    }),

    rendererReady: () => {},
    onColdStartIntentsSettled: (cb) => {
      queueMicrotask(() => cb());
      return () => {};
    },
    onSshDeepLink: () => () => {},
    onTelnetDeepLink: () => () => {},
    onOpenTerminalPath: () => () => {},
    onJmsDeepLink: () => () => {},

    // ── App Lock & Credentials ──
    getAppLockRuntimeState: async () => ({
      initialized: true,
      locked: false,
      reason: null,
      version: 1,
      lastLockedAt: null,
      lastUnlockedAt: Date.now(),
      lastActivityAt: Date.now(),
    }),
    getAppLockSettings: async () => ({
      enabled: false,
      timeoutMinutes: 15 as const,
      systemUnlockEnabled: false,
      systemUnlockAutoPromptEnabled: false,
      passwordVerifier: null,
    }),
    setAppLockTimeoutMinutes: unsupportedMobile,
    requestAppLockEnable: unsupportedMobile,
    requestAppLockDisable: unsupportedMobile,
    requestAppLockReset: unsupportedMobile,
    requestAppLockPasswordChange: unsupportedMobile,
    setAppLockRuntimeLocked: unsupportedMobile,
    requestAppLockUnlock: unsupportedMobile,
    getAppLockSystemUnlockStatus: async () => ({
      supported: false,
      available: false,
      enabled: false,
      platform: 'unsupported' as const,
      label: null,
      reason: null,
    }),
    setAppLockSystemUnlockEnabled: async () => ({ ok: false, error: 'unsupported' }),
    requestAppLockSystemUnlock: async () => ({ ok: false, error: 'unsupported' } as any),
    reportAppLockActivity: async () => {},
    onAppLockSettingsChanged: () => () => {},
    onAppLockRuntimeStateChanged: () => () => {},
    onAppLockReopen: () => () => {},

    // ── TOTP 2FA Preview (WebCrypto RFC 6238) ──
    previewTotp: async (payload: any) => previewTotpWebCrypto(payload),
    scanTotpQrFromScreen: async () => ({ ok: false, error: 'unavailable' } as any),

    credentialsAvailable: async () => Boolean(getNative()?.credentialsAvailable()),
    credentialsEncrypt: async (plaintext: string) => {
      const result = getNative()?.credentialsEncrypt(plaintext);
      if (!result) throw new Error('Android credential encryption unavailable');
      return result;
    },
    credentialsDecrypt: async (value: string) => {
      const native = getNative();
      if (!native) throw new Error('Android credential decryption unavailable');
      return native.credentialsDecrypt(value);
    },

    // ── Clipboard ──
    readClipboardText: async () => {
      const native = getNative();
      if (native) return native.readClipboard();
      return navigator.clipboard?.readText?.() || '';
    },
    writeClipboardText: async (text: string) => {
      const native = getNative();
      if (native) {
        native.copyToClipboard(text);
        return true;
      }
      if (!navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(text);
      return true;
    },
    readClipboardFiles: async () => [],
    readClipboardImage: async () => null,
    hasClipboardImage: async () => false,

    // ── Vault Backups & Dialogs ──
    getVaultBackupCapabilities: async () => ({ encryptionAvailable: false }),
    createVaultBackup: unsupportedMobile,
    listVaultBackups: async () => [],
    readVaultBackup: unsupportedMobile,
    trimVaultBackups: unsupportedMobile,
    clearVaultBackups: unsupportedMobile,
    openVaultBackupDir: unsupportedMobile,
    onVaultBackupsChanged: () => () => {},

    showSaveDialog: async (defaultPath?: any) => {
      const home = getNative()?.getHomeDirSync() || '/sdcard/Download';
      const fname =
        typeof defaultPath === 'string'
          ? defaultPath.split('/').pop()
          : defaultPath?.defaultPath || `netcatty-export-${Date.now()}.json`;
      return `${home}/Downloads/${fname || `netcatty-export-${Date.now()}.json`}`;
    },
    selectDirectory: async () => {
      const home = getNative()?.getHomeDirSync() || '/sdcard/Download';
      return `${home}/Downloads`;
    },
    selectFile: async () => {
      const native = getNative();
      if (!native?.requestOpenFilePicker) return null;
      const cbId = nextReqId('filepick');
      return new Promise<string | null>((resolve) => {
        const timer = window.setTimeout(() => {
          pendingFilePickers.delete(cbId);
          resolve(null);
        }, 120000);
        pendingFilePickers.set(cbId, (res) => {
          window.clearTimeout(timer);
          if (res.canceled || !res.filePath) resolve(null);
          else resolve(res.filePath);
        });
        native.requestOpenFilePicker(cbId);
      });
    },
    selectApplication: async () => null,

    // ── AI Bridge ──
    aiSyncProviders: async (providers) => {
      cachedAiProviders = [];
      const decrypted = await Promise.all(providers.map(async (provider) => ({
        ...provider,
        apiKey: provider.apiKey?.startsWith('enc:') ? await bridge.credentialsDecrypt!(provider.apiKey) : provider.apiKey,
      })));
      cachedAiProviders = decrypted;
      return { ok: true };
    },
    aiSyncWebSearch: unsupportedMobile,
    aiAllowlistAddHost: unsupportedMobile,
    aiFetch: async (url, method, headers, body, providerId, _skipHostCheck, _followRedirects, skipTLSVerify) => {
      const native = getNative();
      if (!native) return { ok: false, status: 0, data: '', error: 'NativeBridge unavailable' };
      const resolved = resolveAiRequestAuth(url, headers, providerId);
      const res = await callNativeAsync((reqId) =>
        native.httpFetchAsync(
          reqId,
          resolved.url,
          method || 'GET',
          JSON.stringify(resolved.headers),
          body || '',
          Boolean(skipTLSVerify),
        ),
      );
      return {
        ok: Boolean(res?.ok),
        status: res?.status || 0,
        data: res?.data || '',
        error: res?.error,
      };
    },
    aiChatStream: async (requestId, url, headers, body, providerId) => {
      const native = getNative();
      if (!native) return { ok: false, error: 'NativeBridge unavailable' };
      const resolved = resolveAiRequestAuth(url, headers, providerId);
      const res = await callNativeAsync((reqId) =>
        native.startAiChatStream(
          reqId,
          requestId,
          resolved.url,
          JSON.stringify(resolved.headers),
          body || '',
          false,
        ),
      );
      return {
        ok: Boolean(res?.ok),
        statusCode: res?.statusCode || 200,
        statusText: res?.statusText || 'OK',
      };
    },
    aiChatCancel: async (requestId: string) => {
      return Boolean(getNative()?.cancelAiChatStream(requestId));
    },
    onAiStreamData: (requestId: string, cb) => {
      if (!aiStreamDataListeners.has(requestId)) aiStreamDataListeners.set(requestId, new Set());
      aiStreamDataListeners.get(requestId)!.add(cb);
      return () => aiStreamDataListeners.get(requestId)?.delete(cb);
    },
    onAiStreamEnd: (requestId: string, cb) => {
      if (!aiStreamEndListeners.has(requestId)) aiStreamEndListeners.set(requestId, new Set());
      aiStreamEndListeners.get(requestId)!.add(cb);
      return () => aiStreamEndListeners.get(requestId)?.delete(cb);
    },
    onAiStreamError: (requestId: string, cb) => {
      if (!aiStreamErrorListeners.has(requestId)) aiStreamErrorListeners.set(requestId, new Set());
      aiStreamErrorListeners.get(requestId)!.add(cb);
      return () => aiStreamErrorListeners.get(requestId)?.delete(cb);
    },
    aiExec: async (sessionId: string, command: string) => {
      const res = await execOnSessionHelper(sessionId, command, 30000);
      return {
        ok: res.success,
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.code,
        error: res.error,
      };
    },
    aiCattyCancelExec: unsupportedMobile,
    aiSetChatSessionCancelled: unsupportedMobile,
    aiDiscoverAgents: async () => [],
    aiUserSkillsGetStatus: async () => ({
      ok: true,
      directoryPath: '',
      skills: [],
      warnings: [],
    }),
    aiMcpUpdateSessions: unsupportedMobile,
    aiMcpUpdateLiveSessions: unsupportedMobile,
    aiMcpMergeSessions: unsupportedMobile,
    aiMcpUpdateAttachments: unsupportedMobile,
    aiMcpSetCommandBlocklist: unsupportedMobile,
    aiMcpSetCommandTimeout: unsupportedMobile,
    aiMcpSetMaxIterations: unsupportedMobile,
    aiMcpSetPermissionMode: unsupportedMobile,
    aiMcpSetToolIntegrationMode: unsupportedMobile,
    aiMcpSyncPermissionGrants: unsupportedMobile,
    onMcpApprovalRequest: () => () => {},
    onMcpApprovalCleared: () => () => {},
    respondMcpApproval: unsupportedMobile,
    cancelMcpApprovalTimeout: unsupportedMobile,
    onVaultAgentRequest: () => () => {},
    respondVaultAgent: unsupportedMobile,

    // ── Plugins & Misc Stubs ──
    pluginHostReady: () => false,
    getPluginRuntimeStatus: async () => ({ available: false, ready: false, plugins: [] } as any),
    listPlugins: async () => [],
    listPluginSources: async () => [],
    listPluginCatalog: async () => ({ plugins: [] } as any),
    getPluginThemes: async () => ({
      selection: { formatVersion: 1, revision: 0, light: null, dark: null },
      entries: [],
      diagnostics: [],
    } as any),
    getPluginContributions: async () => ({ locale: 'en', plugins: [] } as any),
    listPluginTerminalProviders: async () => [],
    listPluginExtensionProviders: async () => [],
    onPluginContributionsChanged: () => () => {},
    onPluginThemesChanged: () => () => {},
    onSystemThemeChanged: () => () => {},
    getPluginScopeCatalog: async () => ({ hosts: [], groups: [], keys: [], identities: [], snippets: [] } as any),
    setPluginScopeCatalog: unsupportedMobile,
    onPluginScopeCatalogChanged: () => () => {},
    setPluginEnvironment: unsupportedMobile,
    setPluginInteractionReady: unsupportedMobile,
    setPluginPermissionReady: unsupportedMobile,
    setPluginAIHostReady: unsupportedMobile,
    setPluginAgentHostReady: unsupportedMobile,
    updatePluginCredentialCatalog: unsupportedMobile,
    onPluginInteraction: () => () => {},
    onPluginPermission: () => () => {},
    onPluginAIHostRequest: () => () => {},
    onPluginAgentHostRequest: () => () => {},
    onPluginAuthenticationChallenge: () => () => {},
    respondPluginAuthenticationChallenge: async () => ({ ok: true } as any),
    onPluginConnectionData: () => () => {},
    onPluginConnectionClosed: () => () => {},
    onPluginViewClosed: () => () => {},
    onHostDrawnPluginViewUpdate: () => () => {},
    openHostDrawnPluginView: async () => ({ ok: false } as any),
    closeHostDrawnPluginView: async () => ({ ok: true } as any),
    sendHostDrawnPluginViewEvent: async () => ({ ok: true } as any),
    getPluginViewResource: async () => null as any,
    collectPluginSyncSidecars: async () => ({ version: 1, entries: [] } as any),
    applyPluginSyncSidecars: async () => ({ ok: true } as any),

    // ── Auto-Update, Tray, Hotkeys, Network Proxy & Diagnostics Stubs ──
    checkForUpdate: async () => ({ available: false, supported: false, checking: false }),
    downloadUpdate: async () => ({ success: false }),
    installUpdate: () => {},
    getUpdateStatus: async () => ({
      status: 'idle' as const,
      percent: 0,
      error: null,
      version: null,
      isChecking: false,
    }),
    onUpdateDownloadProgress: () => () => {},
    onUpdateAvailable: () => () => {},
    onUpdateNotAvailable: () => () => {},
    onUpdateDownloaded: () => () => {},
    onUpdateError: () => () => {},
    onUpdateNeedsSave: () => () => {},
    getAutoUpdate: async () => ({ enabled: false }),
    setAutoUpdate: async () => ({ success: true }),
    setSshDeepLinkEnabled: async () => ({ success: true, enabled: true }),
    getSshDeepLinkEnabled: async () => true,
    setJmsDeepLinkEnabled: async () => ({ success: true, enabled: false }),
    getJmsDeepLinkEnabled: async () => false,
    setExplorerContextMenuEnabled: async () => ({ success: true, enabled: false, supported: false }),
    getExplorerContextMenuEnabled: async () => ({ enabled: false, supported: false }),
    registerGlobalHotkey: async () => ({ success: false, enabled: false }),
    unregisterGlobalHotkey: async () => ({ success: true }),
    getGlobalHotkeyStatus: async () => ({ enabled: false, hotkey: null }),
    getSshDebugLogInfo: async () => ({ enabled: false, path: '', exists: false, size: 0 }),
    openSshDebugLogDir: async () => ({ success: true }),
    setCloseToTray: async () => ({ success: true, enabled: false }),
    isCloseToTray: async () => ({ enabled: false }),
    setShowTrayIcon: async () => ({ success: true, enabled: false }),
    isShowTrayIcon: async () => ({ enabled: false }),
    getAutoLaunch: async () => ({ success: true, enabled: false, supported: false }),
    setAutoLaunch: async () => ({ success: true, enabled: false, supported: false }),
    setHttpNetworkProxy: async (settings) => ({ success: true, settings }),
    getHttpNetworkProxy: async () => ({
      settings: { mode: 'system' as const, url: '', bypass: '' },
    }),
    updateTrayMenuData: async () => ({ success: true }),
    onTrayFocusSession: () => () => {},
    onTrayTogglePortForward: () => () => {},
    onTrayPanelJumpToSession: () => () => {},
    onTrayPanelConnectToHost: () => () => {},
    onTrayPanelCloseSession: () => () => {},
    hideTrayPanel: async () => ({ success: true }),
    openMainWindow: async () => ({ success: true }),
    quitApp: async () => ({ success: true }),
    onTrayPanelCloseRequest: () => () => {},
    onTrayPanelRefresh: () => () => {},
    onTrayPanelMenuData: () => () => {},
    onCheckDirtyEditors: () => () => {},
    reportDirtyEditorsResult: () => {},
    onCodexAppServerInteractionRequest: () => () => {},
    onCodexAppServerInteractionCleared: () => () => {},
    respondCodexAppServerInteraction: async () => ({ ok: true } as any),
    cancelCodexAppServerInteractionTimeout: async () => ({ ok: true } as any),
    onScriptRunsUpdated: () => () => {},
    onScriptDialogRequest: () => () => {},
    onScriptScreenSnapshotRequest: () => () => {},
    onScriptSessionInput: () => () => {},
    scriptGetRuns: async () => [],
    getHostBrowserBookmarks: async () => [],
    applyHostBrowserBookmarks: async () => ({ ok: true } as any),
    onHostBrowserBookmarksChanged: () => () => {},
    onHostBrowserPanelRequest: () => () => {},
    onHostBrowserPanelEvent: () => () => {},

    // Fig specs / Autocomplete
    listFigSpecs: async () => [],
    loadFigSpec: async () => null,
    listAutocompleteRemoteDir: async (sessionId, dirPath) => {
      const res = await execOnSessionHelper(
        sessionId,
        `ls -1p -- ${shellQuote(dirPath || '.')} 2>/dev/null | head -n 60`,
        3000,
      );
      if (!res.success) return { success: false, entries: [] };
      const entries = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((name) => ({
          name: name.replace(/\/$/, ''),
          type: (name.endsWith('/') ? 'directory' : 'file') as 'directory' | 'file',
        }));
      return { success: true, entries };
    },
    listAutocompleteLocalDir: async () => ({ success: true, entries: [] }),
  };

  // ── Complete IPC Parity Stubs & Mobile Safe Implementations (Zero-Gap Coverage) ──
  const extraBridgeMethods = {
    externalMcpGetStatus: unsupportedMobile,
    externalMcpSetEnabled: async () => ({ ok: false, error: 'External CLI MCP daemon is desktop-only' } as any),
    externalMcpSetConfig: unsupportedMobile,
    externalMcpCodexGetStatus: unsupportedMobile,
    externalMcpClaudeGetStatus: unsupportedMobile,
    externalMcpGrokGetStatus: unsupportedMobile,
    externalMcpCodexAdd: async () => ({ ok: false, error: 'Unsupported on Android' } as any),
    externalMcpClaudeAdd: async () => ({ ok: false, error: 'Unsupported on Android' } as any),
    externalMcpGrokAdd: async () => ({ ok: false, error: 'Unsupported on Android' } as any),
    externalMcpGetUniversalSetupPrompt: async () => ({ ok: false, prompt: '' } as any),
    setExternalMcpApprovalAlertMode: unsupportedMobile,

    // System Temp / Crash Logs / Session Logs
    getTempDirInfo: async () => {
      const home = getNative()?.getHomeDirSync() || '/data/user/0/de.newaii.netcatty/files';
      return { path: `${home}/Downloads`, isCustom: false, sizeBytes: 0, fileCount: 0 } as any;
    },
    clearTempDir: unsupportedMobile,
    setCustomTempDir: unsupportedMobile,
    resetCustomTempDir: unsupportedMobile,
    chooseTempDir: async () => null as any,
    openTempDir: unsupportedMobile,
    getCrashLogs: async () => [] as any,
    readCrashLog: async () => [] as any,
    clearCrashLogs: unsupportedMobile,
    openCrashLogsDir: unsupportedMobile,
    selectSessionLogsDir: async () => {
      const home = getNative()?.getHomeDirSync() || '/data/user/0/de.newaii.netcatty/files';
      return { canceled: false, path: `${home}/Downloads` } as any;
    },
    openSessionLogsDir: unsupportedMobile,
    clearSessionLogsDir: unsupportedMobile,
    prepareSessionLog: async () => ({ ok: false, error: 'Session log file export unavailable on mobile' } as any),
    exportSessionLog: unsupportedMobile,
    revealSessionLog: unsupportedMobile,
    chooseManualSessionLogPath: async () => null as any,
    startManualSessionLog: unsupportedMobile,
    stopManualSessionLog: unsupportedMobile,
    getManualSessionLogStatus: async () => ({ active: false } as any),

    // Editor Window & File Watch
    openEditorWindow: async (snapshot: any) => {
      editorOpenTabListeners.forEach((cb) => {
        try {
          cb(snapshot);
        } catch {}
      });
      return { success: true };
    },
    focusEditorWindow: unsupportedMobile,
    closeEditorWindowTabs: unsupportedMobile,
    dockEditorWindowTab: unsupportedMobile,
    saveEditorWindowTab: unsupportedMobile,
    remapEditorWindowSession: unsupportedMobile,
    onEditorWindowOpenTab: (cb: any) => {
      editorOpenTabListeners.add(cb);
      return () => editorOpenTabListeners.delete(cb);
    },
    onEditorWindowActivateTab: () => () => {},
    onEditorWindowRemapSession: () => () => {},
    onEditorWindowCloseTabs: () => () => {},
    onEditorWindowDockRequest: () => () => {},
    onEditorWindowSaveRequest: () => () => {},
    onEditorWindowDirtyChanged: () => () => {},
    onEditorWindowTabsClosed: () => () => {},
    reportEditorWindowCloseTabsResult: () => {},
    reportEditorWindowDirty: () => {},
    reportEditorWindowDockResult: () => {},
    reportEditorWindowSaveResult: () => {},
    reportEditorWindowTabsClosed: () => {},

    startFileWatch: async () => ({ success: false, error: 'External app watch unsupported on Android' } as any),
    stopFileWatch: unsupportedMobile,
    onFileWatchSynced: () => () => {},
    onFileWatchError: () => () => {},
    onFileWatchStopped: () => () => {},
    registerTempFile: unsupportedMobile,
    unregisterTempFile: unsupportedMobile,
    deleteTempFile: async (filePath: string) => {
      getNative()?.deleteLocalFile(filePath);
      return { success: true } as any;
    },
    stageUploadFile: async () => '' as any,
    cancelStagedUploadFile: unsupportedMobile,
    openWithApplication: async () => ({ success: false, error: 'Use built-in SFTP text editor on Android' } as any),
    openWithSystemDefault: async () => ({ success: false } as any),
    startLocalFileDrag: async () => ({ started: false } as any),
    cancelLocalFileDrag: unsupportedMobile,
    createSftpArchive: async () => ({ success: false, error: 'Archive creation requires SSH shell tar' } as any),
    extractSftpArchive: async () => ({ success: false, error: 'Archive extraction requires SSH shell tar' } as any),
    extractLocalArchive: async () => ({ success: false, error: 'Local archive extraction unsupported' } as any),

    // Popup / Multi-Window / Snapshot Stubs
    openTerminalPopup: async () => ({ ok: false, error: 'Popup windows are disabled on mobile' } as any),
    openSessionInNewWindow: async () => ({ ok: false, error: 'Multi-window is disabled on mobile' } as any),
    onOpenSessionInNewWindow: () => () => {},
    onTerminalPopupConfig: () => () => {},
    onTerminalPopupPrepareClose: () => () => {},
    markAttachPopupClosePrepared: () => {},
    onTerminalSessionSnapshotRequest: () => () => {},
    onTerminalSessionApplySnapshot: () => () => {},
    requestTerminalSessionSnapshot: async () => null as any,
    respondTerminalSessionSnapshot: () => {},
    applyTerminalSessionSnapshot: unsupportedMobile,
    rebindTerminalSessionOutput: unsupportedMobile,
    restoreTerminalSessionOutput: unsupportedMobile,
    sendSerialYmodem: async () => ({ success: false, error: 'Serial YMODEM unavailable on Android' } as any),
    receiveSerialYmodem: async () => ({ success: false, error: 'Serial YMODEM unavailable on Android' } as any),
    startZmodemDragDropUpload: async () => ({ success: false } as any),
    ptyGetChildProcesses: async () => [] as any,
    getWindowsPtyInfo: () => null,

    // AI CLI / Codex / SDK / Privacy / Backup Stubs
    aiResolveCli: async () => ({ ok: false, found: false } as any),
    aiPrewarmShellEnv: unsupportedMobile,
    aiCodexGetIntegration: unsupportedMobile,
    aiCodexGetLoginSession: async () => null as any,
    aiCodexStartLogin: async () => ({ ok: false, error: 'Codex CLI unavailable on Android' } as any),
    aiCodexCancelLogin: unsupportedMobile,
    aiCodexLogout: unsupportedMobile,
    codexAppServerGetStatus: unsupportedMobile,
    aiUserSkillsOpenFolder: unsupportedMobile,
    aiUserSkillsBuildContext: unsupportedMobile,
    aiSessionsBackupExport: async () => ({ ok: false, canceled: true } as any),
    aiSessionsBackupImport: async () => ({ ok: false, canceled: true } as any),
    aiSessionsBackupReadLatest: async () => ({ ok: false } as any),
    aiSdkAgentCancel: unsupportedMobile,
    aiSdkAgentCleanup: unsupportedMobile,
    aiSdkAgentListModels: unsupportedMobile,
    aiSdkAgentElicitationResponse: unsupportedMobile,
    aiPrivacyStatus: async () => ({ ok: true, enabled: false }),
    aiPrivacyTransform: unsupportedMobile,
    aiPrivacyClearSession: unsupportedMobile,
    aiCapability: async () => ({ ok: false, error: 'Unsupported capability on Android' } as any),
    deleteChatToolOutputsTemp: unsupportedMobile,
    deleteTerminalToolOutputsEverywhereTemp: unsupportedMobile,

    // Host Browser / Automation Scripts / Plugin Management Stubs
    openHostBrowser: unsupportedMobile,
    openHostBrowserUrl: async ({ url }: any) => {
      if (url) await bridge.openExternal!(url);
      return { ok: true } as any;
    },
    requestHostBrowserPanel: async () => ({ ok: false } as any),
    closeHostBrowserPanel: unsupportedMobile,
    commandHostBrowserPanel: async () => ({ ok: false } as any),
    commandHostBrowserPanelDownload: async () => ({ ok: false } as any),
    getHostBrowserPanelState: async () => null as any,
    setHostBrowserPanelLayout: unsupportedMobile,
    listHostBrowserPanelBookmarks: async () => [] as any,
    saveHostBrowserPanelBookmark: unsupportedMobile,
    removeHostBrowserPanelBookmark: unsupportedMobile,
    listHostBrowserPanelDownloads: async () => [] as any,

    scriptRun: async () => ({ ok: false, error: 'Script runner unavailable on mobile' } as any),
    scriptStop: unsupportedMobile,
    scriptPause: unsupportedMobile,
    scriptResume: unsupportedMobile,
    scriptDialogResponse: unsupportedMobile,
    scriptScreenSnapshotResponse: unsupportedMobile,
    scriptRecordingStart: unsupportedMobile,
    scriptRecordingStop: unsupportedMobile,
    scriptRecordingAppendStep: unsupportedMobile,

    prepareGitHubPlugin: async () => ({ ok: false, error: 'Desktop plugins unavailable on mobile' } as any),
    installGitHubPlugin: async () => ({ ok: false, error: 'Desktop plugins unavailable on mobile' } as any),
    discardGitHubPlugin: unsupportedMobile,
    installCatalogPlugin: async () => ({ ok: false, error: 'Desktop plugins unavailable on mobile' } as any),
    installPluginPackage: async () => ({ ok: false, error: 'Desktop plugins unavailable on mobile' } as any),
    uninstallPlugin: unsupportedMobile,
    setPluginEnabled: async () => ({ ok: false } as any),
    resetPluginSource: unsupportedMobile,
    applyPluginTheme: async () => ({
      selection: { formatVersion: 1, revision: 0, light: null, dark: null },
      entries: [],
      diagnostics: [],
    } as any),
    executePluginCommand: async () => ({ ok: false } as any),
    updatePluginSetting: unsupportedMobile,
    resetPluginSetting: unsupportedMobile,
    getPluginCatalogReadme: async () => '' as any,
    getPluginCatalogReadmeImages: async () => ({}) as any,
    getPluginPermissions: async () => ({ permissions: [], policyRevision: 0 } as any),
    setPluginPermissionMode: unsupportedMobile,
    revokePluginPermissions: unsupportedMobile,
    getPluginLogStatus: async () => ({ enabled: false, path: '' } as any),
    configurePluginLogs: unsupportedMobile,
    clearPluginLogs: unsupportedMobile,
    exportPluginLogs: async () => ({ ok: false } as any),
    openPluginLogFolder: unsupportedMobile,
    detectPluginImporter: async () => null as any,
    parsePluginImporterFile: async () => ({ hosts: [] } as any),
    selectPluginImporterFile: async () => null as any,
    onPluginImporterProgress: () => () => {},
    onPluginCatalogChanged: () => () => {},
    invokePluginExtensionProvider: async () => ({ ok: false } as any),
    cancelPluginExtensionRequest: async () => false as any,
    startPluginConnection: async () => ({ ok: false } as any),
    controlPluginConnection: async () => ({ ok: false } as any),
    cancelPluginTerminalRequest: async () => false as any,
    providePluginTerminal: async () => ({ ok: false } as any),
    publishPluginTerminalSessionEvent: unsupportedMobile,
    setPluginTerminalTarget: unsupportedMobile,
    respondPluginAIHost: unsupportedMobile,
    respondPluginInteraction: async () => true as any,
    getPluginAuthorPresentation: async () => null as any,
    getPluginBrandIcon: async () => null as any,
    getPluginContributionIcon: async () => null as any,
    getPluginSourceBinding: async () => null as any,

    // Misc Helpers
    logDiagnostic: async () => ({ success: false, error: 'Native diagnostic persistence unsupported' }),
    showSystemNotification: unsupportedMobile,
    confirmCloseBusy: async () => true as any,
    getPathForFile: (file: File) => (file as File & { path?: string }).path,
    prepareOAuthCallback: unsupportedMobile,
    awaitOAuthCallback: unsupportedMobile,
    cancelOAuthCallback: unsupportedMobile,
    connectToHostFromTrayPanel: unsupportedMobile,
    jumpToSessionFromTrayPanel: unsupportedMobile,
    closeSessionFromTrayPanel: unsupportedMobile,
    startPortForwardFromTrayPanel: unsupportedMobile,

    // No native OAuth redirect receiver exists: fail closed for these providers.
    googleExchangeCodeForTokens: unsupportedMobile,
    googleRefreshAccessToken: unsupportedMobile,
    googleGetUserInfo: unsupportedMobile,
    googleDriveFindSyncFile: unsupportedMobile,
    googleDriveDownloadSyncFile: unsupportedMobile,
    googleDriveCreateSyncFile: unsupportedMobile,
    googleDriveUpdateSyncFile: unsupportedMobile,
    googleDriveDeleteSyncFile: unsupportedMobile,
    onedriveExchangeCodeForTokens: unsupportedMobile,
    onedriveRefreshAccessToken: unsupportedMobile,
    onedriveGetUserInfo: unsupportedMobile,
    onedriveFindSyncFile: unsupportedMobile,
    onedriveDownloadSyncFile: unsupportedMobile,
    onedriveUploadSyncFile: unsupportedMobile,
    onedriveDeleteSyncFile: unsupportedMobile,
  };

  // Validate extra methods too; unknown legacy aliases do not erase known contracts.
  const checkedExtra: Partial<NetcattyBridge> & Record<string, unknown> = extraBridgeMethods;
  Object.assign(bridge, checkedExtra);
  window.netcatty = bridge;
}
