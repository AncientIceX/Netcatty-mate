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
 * 2. SFTP is strictly PULL-ONLY on remote hosts (browse, read, download to local Android
 *    sandbox; remote write/delete/mkdir/upload operations are safely blocked).
 */

interface AndroidNativeBridge {
  getDeviceSysInfo(): string;
  vibrateShort(): void;
  openExternalUrl(url: string): void;
  setStatusBarColorHex(hexColor: string): void;
  copyToClipboard(text: string): void;
  readClipboard(): string;

  // SSH / Local Shell / TCP Sessions
  connectSshSession(reqId: string, jsonConfig: string): void;
  testSshConnection(reqId: string, jsonConfig: string): void;
  writeTerminalBytesB64(sessionId: string, dataB64: string): void;
  resizeSshPty(sessionId: string, cols: number, rows: number): void;
  startLocalShell(reqId: string, sessionId: string, initDir: string): void;
  connectTcpSession(reqId: string, sessionId: string, host: string, port: number): void;
  closeSession(sessionId: string): void;

  // SFTP (Pull-Only on Remote)
  sftpOpenSession(reqId: string, sftpId: string, sourceSessionId: string, sshConfigJson: string): void;
  sftpList(reqId: string, sftpId: string, remotePath: string): void;
  sftpStat(reqId: string, sftpId: string, remotePath: string, followLinks: boolean): void;
  sftpHomeAndRealpath(reqId: string, sftpId: string, remotePath: string): void;
  sftpReadFile(reqId: string, sftpId: string, remotePath: string, asBase64: boolean): void;
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
  const settingsChangedListeners = new Set<(payload: { key: string; value: string | null }) => void>();
  const aiStreamDataListeners = new Map<string, Set<(data: string) => void>>();
  const aiStreamEndListeners = new Map<string, Set<() => void>>();
  const aiStreamErrorListeners = new Map<string, Set<(err: string) => void>>();
  const pasteWriteListeners = new Set<(payload: any) => void>();

  // Per-session UTF-8 streaming decoder so split multi-byte sequences never corrupt
  const sessionDecoders = new Map<string, TextDecoder>();

  function callNativeAsync<T = any>(
    invoke: (reqId: string) => void,
    timeoutMs = 30000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const reqId = nextReqId('async');
      const timer = window.setTimeout(() => {
        pendingAsync.delete(reqId);
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
        if (payload.ok === false && payload.error && payload.status === undefined && payload.success === undefined) {
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
      globalSftpTransferListeners.forEach((cb) => {
        try {
          cb(payload);
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
      const rawKey = provider?.apiKey ? String(provider.apiKey).replace(/^enc:v1:/, '') : '';
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
  const bridge: NetcattyBridge = {
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

    cancelTestConnection: async () => {},

    startTelnetSession: async (options: TelnetConnectOptions): Promise<string> => {
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

    startMoshSession: async (options: MoshConnectOptions): Promise<string> => {
      // Fallback Mosh to standard SSHv2 PTY on Android
      return bridge.startSSHSession(options as unknown as NetcattySSHOptions);
    },

    startEtSession: async (options: EtConnectOptions): Promise<string> => {
      return bridge.startSSHSession(options as unknown as NetcattySSHOptions);
    },

    startLocalSession: async (options?: LocalConnectOptions): Promise<string> => {
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

    getDefaultShell: async () => ({
      path: '/system/bin/sh',
      name: 'Android Shell (sh)',
      available: true,
    }),

    discoverShells: async () => [
      { id: 'sh', name: 'Android POSIX sh', path: '/system/bin/sh', args: ['-i'] },
    ],

    validatePath: async (path: string) => {
      const native = getNative();
      if (!native) return { valid: true, exists: true };
      const statStr = native.statLocalFileSync(path);
      return { valid: Boolean(statStr), exists: Boolean(statStr) };
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
    setSessionFlowPausedAndWait: async () => ({ success: true }),
    acquireSessionFlowPauseLease: async () => ({ success: true, leaseId: 'lease-1', paused: true }),
    waitSessionFlowPauseLease: async () => ({ success: true }),
    releaseSessionFlowPauseLease: async () => ({ success: true, paused: false }),
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

    setSessionEncoding: async () => ({ ok: true }),

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
    getTelnetEchoMode: async () => ({ success: true, remoteEcho: true }),
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
    respondKeyboardInteractive: async () => ({ ok: true }),
    onHostKeyVerification: () => () => {},
    respondHostKeyVerification: async () => ({ ok: true }),
    onPassphraseRequest: () => () => {},
    respondPassphrase: async () => ({ ok: true }),
    respondPassphraseSkip: async () => ({ ok: true }),
    onPassphraseTimeout: () => () => {},
    onPassphraseCancelled: () => () => {},
    onPassphraseAuthFailed: () => () => {},
    onFidoPromptRequest: () => () => {},
    respondFidoPrompt: async () => ({ ok: true }),
    onFidoPromptTimeout: () => () => {},
    onFidoPromptCancelled: () => () => {},

    // ── SSH Exec, CWD, Distro, Server Stats & Monitoring ──
    execCommand: async (options) => {
      const native = getNative();
      if (!native) return { success: false, error: 'NativeBridge unavailable' };
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
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
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
      const safeLimit = Math.min(2000, Math.max(50, limit));
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

    checkSshAgent: async () => ({ available: false }),
    getDefaultKeys: async () => [],
    readKnownHosts: async () => [],

    // ── Port Forwarding ──
    startPortForward: async (options) => {
      const native = getNative();
      if (!native) return { success: false, error: 'NativeBridge unavailable' };
      try {
        const res = await callNativeAsync(
          (reqId) => native.startSshPortForward(reqId, JSON.stringify(options)),
          18000,
        );
        return {
          success: Boolean(res?.success),
          tunnelId: res?.tunnelId || options.tunnelId,
          error: res?.error,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    stopPortForward: async (tunnelId: string) => {
      getNative()?.stopSshPortForward(tunnelId);
      return { success: true };
    },

    getPortForwardStatus: async (tunnelId: string) => {
      const list = await bridge.listPortForwards();
      const found = list.find((t) => t.tunnelId === tunnelId);
      return { status: found ? found.status : 'inactive' };
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
      const tunnels = await bridge.listPortForwards();
      return {
        revision: Date.now(),
        tunnels: tunnels.map((t) => ({
          ...t,
          ruleId: (t as any).ruleId || t.tunnelId,
          ownerCount: 1,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        })),
      };
    },

    subscribePortForwardRuntime: async () => bridge.getPortForwardSnapshot!(),
    unsubscribePortForwardRuntime: async () => ({ success: true }),
    stopAllPortForwards: async () => {
      getNative()?.stopAllSshPortForwards();
      return { stoppedCount: 0, totalCount: 0 };
    },
    stopPortForwardByRuleId: async (ruleId: string) => {
      getNative()?.stopSshPortForward(ruleId);
      return { success: true };
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

    // ── SFTP Operations (Strictly PULL-ONLY on Remote Host) ──
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

    // STRICT PULL-ONLY LOCK FOR REMOTE SFTP WRITES
    writeSftp: async () => {
      throw new Error('手机端 SFTP 已锁定为「只下拉不上传」只读模式，禁止修改远端服务器文件');
    },
    writeSftpBinary: async () => {
      throw new Error('手机端 SFTP 已锁定为「只下拉不上传」只读模式，禁止上传或覆盖远端文件');
    },
    mkdirSftp: async () => {
      throw new Error('手机端 SFTP 已锁定为「只下拉不上传」只读模式，禁止在远端创建目录');
    },
    deleteSftp: async () => {
      throw new Error('手机端 SFTP 已锁定为「只下拉不上传」只读模式，禁止删除远端文件');
    },
    renameSftp: async () => {
      throw new Error('手机端 SFTP 已锁定为「只下拉不上传」只读模式，禁止重命名远端文件');
    },
    chmodSftp: async () => {
      throw new Error('手机端 SFTP 已锁定为「只下拉不上传」只读模式，禁止修改远端权限');
    },
    startCompressedUpload: async (options) => ({
      compressionId: options.compressionId,
      success: false,
      error: '手机端 SFTP 已锁定为「只下拉不上传」只读模式，禁止向远端上传文件夹',
    }),
    checkCompressedUploadSupport: async () => ({
      supported: false,
      localTar: false,
      remoteTar: false,
    }),

    closeSftp: async (sftpId: string) => {
      getNative()?.sftpCloseSession(sftpId);
      return { success: true };
    },
    retainSftpTransferSession: async () => ({ success: true }),
    releaseSftpTransferSession: async () => ({ success: true }),

    startStreamTransfer: async (options) => {
      // Strictly block any transfer where targetType === 'sftp' (upload to remote)
      if (options.targetType === 'sftp') {
        const errMsg = '手机端已锁定「只下拉不上传」保护策略：仅允许从远端服务器下载到本地，禁止上传覆盖远端';
        queueMicrotask(() => {
          globalSftpTransferListeners.forEach((cb) => {
            try {
              cb({
                type: 'failed',
                transferId: options.transferId,
                direction: 'upload',
                sourcePath: options.sourcePath,
                targetPath: options.targetPath,
                error: errMsg,
                endedAt: Date.now(),
              });
            } catch {}
          });
        });
        return { transferId: options.transferId, error: errMsg };
      }

      const native = getNative();
      if (!native || !options.sourceSftpId) {
        return { transferId: options.transferId, error: 'SFTP source session unavailable' };
      }
      const res = await callNativeAsync(
        (reqId) =>
          native.sftpStreamDownloadToLocal(
            reqId,
            options.transferId,
            options.sourceSftpId!,
            options.sourcePath,
            options.targetPath,
          ),
        300000,
      );
      return {
        transferId: options.transferId,
        totalBytes: res?.totalBytes,
        cancelled: res?.cancelled,
        error: res?.error,
      };
    },

    cancelTransfer: async (transferId: string) => {
      getNative()?.cancelSftpTransfer(transferId);
    },
    clearPendingTransferCancel: async () => ({ success: true }),
    pauseTransfer: async () => ({ success: false, reason: 'Not supported on mobile' }),
    resumeTransfer: async () => ({ success: false, reason: 'Not supported on mobile' }),
    prioritizeTransfer: async () => ({ success: true }),
    setGlobalTransferConcurrency: async (limit: number) => ({ success: true, limit }),
    cleanupTransferArtifacts: async () => ({ success: true }),
    onGlobalSftpTransferEvent: (cb) => {
      globalSftpTransferListeners.add(cb);
      return () => globalSftpTransferListeners.delete(cb);
    },

    downloadSftpToTempWithProgress: async (sftpId, remotePath, fileName, _encoding, transferId) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const home = native.getHomeDirSync();
      const targetPath = `${home}/Downloads/${fileName || remotePath.split('/').pop() || 'download.bin'}`;
      const tid = transferId || `dl-${Date.now()}`;
      const res = await callNativeAsync(
        (reqId) => native.sftpStreamDownloadToLocal(reqId, tid, sftpId, remotePath, targetPath),
        300000,
      );
      if (res?.error) throw new Error(res.error);
      return targetPath;
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
      if (!native) return;
      native.writeLocalFileB64(path, arrayBufferToB64(content));
    },
    deleteLocalFile: async (path: string) => {
      getNative()?.deleteLocalFile(path);
    },
    renameLocalFile: async (oldPath: string, newPath: string) => {
      getNative()?.renameLocalFile(oldPath, newPath);
    },
    mkdirLocal: async (path: string) => {
      getNative()?.mkdirLocal(path);
    },
    listLocalTree: async () => [],
    cancelLocalTreeScan: async () => {},

    // ── Cloud Sync (Strictly PULL-ONLY / Read-Only on Remote Cloud) ──
    cloudSyncSetSessionPassword: async (password: string) => {
      cloudSyncSessionPassword = password;
      return { ok: true };
    },
    cloudSyncGetSessionPassword: async () => cloudSyncSessionPassword,
    cloudSyncClearSessionPassword: async () => {
      cloudSyncSessionPassword = null;
      return { ok: true };
    },
    onCloudSyncSessionPasswordAvailable: () => () => {},

    githubStartDeviceFlow: async (options) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const body = new URLSearchParams({
        client_id: options.clientId || '',
        scope: options.scope || 'gist read:user',
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
        client_id: options.clientId || '',
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
            Authorization: `Bearer ${options.accessToken}`,
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
      return { resourceId: '/netcatty-vault.json' };
    },
    cloudSyncWebdavDownload: async (config) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const endpoint = String(config.endpoint || '').replace(/\/+$/, '');
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
      const prefix = String(config.prefix || '').trim().replace(/^\/+|\/+$/g, '');
      return { resourceId: prefix ? `${prefix}/netcatty-vault.json` : 'netcatty-vault.json' };
    },
    cloudSyncS3Download: async (config) => {
      const native = getNative();
      if (!native) throw new Error('NativeBridge unavailable');
      const endpoint = String(config.endpoint || '').replace(/\/+$/, '');
      const prefix = String(config.prefix || '').trim().replace(/^\/+|\/+$/g, '');
      const key = prefix ? `${prefix}/netcatty-vault.json` : 'netcatty-vault.json';
      const url = `${endpoint}/${config.bucket}/${key}`;
      const res = await callNativeAsync((reqId) =>
        native.httpFetchAsync(reqId, url, 'GET', '{}', '', Boolean(config.allowInsecure)),
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
      const res = await execOnSessionHelper(sessionId, `kill -s ${signal} ${Number(pid)}`, 5000);
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
      const cmd = action === 'rm' ? `${bin} rm -f ${containerId}` : `${bin} ${action} ${containerId}`;
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
      const res = await execOnSessionHelper(sessionId, `systemctl ${action} ${unitName}`, 15000);
      return { success: res.success && res.code === 0, error: res.stderr || res.error };
    },

    // ── Window Controls, Settings Overlay & System UI ──
    windowMinimize: async () => {},
    windowMaximize: async () => false,
    windowClose: async () => {},
    windowIsMaximized: async () => false,
    windowIsFullscreen: async () => true,
    windowFocus: async () => true,
    setTerminalKeyboardFocus: () => {},
    setWindowTitle: async () => {},
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
      return true;
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
      return { ok: true };
    },

    setBackgroundColor: async (color: string) => {
      if (color && color.startsWith('#')) {
        getNative()?.setStatusBarColorHex(color);
      }
      return { ok: true };
    },

    setWindowOpacity: async () => ({ ok: true }),
    setWindowBackgroundBlur: async () => ({ ok: true }),
    setAppIconVariant: async () => ({ ok: true }),
    setLanguage: async () => ({ ok: true }),
    onLanguageChanged: () => () => {},

    openExternal: async (url: string) => {
      const native = getNative();
      if (native) {
        native.openExternalUrl(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },

    openPath: async () => ({ ok: true }),

    getAppInfo: async () => ({
      name: 'Netcatty Mate Mobile',
      version: '3.0.1',
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
    } as any),
    getAppLockSettings: async () => ({
      enabled: false,
      timeoutMinutes: 15,
      systemUnlockEnabled: false,
      systemUnlockAutoPromptEnabled: false,
      lockOnBackgroundHide: false,
      passwordVerifier: null,
      configCorrupted: false,
    } as any),
    setAppLockTimeoutMinutes: async () => ({ ok: true }),
    requestAppLockEnable: async () => ({ ok: true }),
    requestAppLockDisable: async () => ({ ok: true }),
    requestAppLockReset: async () => ({ ok: true }),
    requestAppLockPasswordChange: async () => ({ ok: true }),
    setAppLockRuntimeLocked: async () => ({ ok: true }),
    requestAppLockUnlock: async () => ({ ok: true }),
    getAppLockSystemUnlockStatus: async () => ({
      supported: false,
      available: false,
      enabled: false,
      platform: 'unsupported',
      label: null,
      reason: null,
    } as any),
    setAppLockSystemUnlockEnabled: async () => ({ ok: true }),
    requestAppLockSystemUnlock: async () => ({ ok: false, error: 'unsupported' } as any),
    reportAppLockActivity: async () => ({ ok: true }),
    onAppLockSettingsChanged: () => () => {},
    onAppLockRuntimeStateChanged: () => () => {},
    onAppLockReopen: () => () => {},

    credentialsAvailable: async () => true,
    credentialsEncrypt: async (plaintext: string) => `enc:v1:${plaintext}`,
    credentialsDecrypt: async (value: string) => value.replace(/^enc:v1:/, ''),

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
        return;
      }
      await navigator.clipboard?.writeText?.(text);
    },
    readClipboardFiles: async () => [],
    readClipboardImage: async () => null,
    hasClipboardImage: async () => false,

    // ── Vault Backups & Dialogs ──
    getVaultBackupCapabilities: async () => ({ encryptionAvailable: true }),
    createVaultBackup: async () => ({ ok: true, id: `bk-${Date.now()}` }),
    listVaultBackups: async () => [],
    readVaultBackup: async () => ({ ok: false }),
    trimVaultBackups: async () => ({ ok: true }),
    clearVaultBackups: async () => ({ ok: true }),
    openVaultBackupDir: async () => ({ ok: true }),
    onVaultBackupsChanged: () => () => {},

    showSaveDialog: async (defaultPath?: string) => {
      const home = getNative()?.getHomeDirSync() || '/sdcard/Download';
      return `${home}/Downloads/${defaultPath || `netcatty-export-${Date.now()}.json`}`;
    },
    selectDirectory: async () => {
      const home = getNative()?.getHomeDirSync() || '/sdcard/Download';
      return `${home}/Downloads`;
    },
    selectFile: async () => null,

    // ── AI Bridge ──
    aiSyncProviders: async (providers) => {
      if (Array.isArray(providers)) cachedAiProviders = providers;
      return { ok: true };
    },
    aiSyncWebSearch: async () => ({ ok: true }),
    aiAllowlistAddHost: async () => ({ ok: true }),
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
    aiCattyCancelExec: async () => ({ ok: true }),
    aiSetChatSessionCancelled: async () => ({ ok: true }),
    aiDiscoverAgents: async () => [],
    aiUserSkillsGetStatus: async () => ({
      ok: true,
      directoryPath: '',
      skills: [],
      warnings: [],
    }),
    aiMcpUpdateSessions: async () => ({ ok: true }),
    aiMcpUpdateLiveSessions: async () => ({ ok: true }),
    aiMcpMergeSessions: async () => ({ ok: true }),
    aiMcpUpdateAttachments: async () => ({ ok: true }),
    aiMcpSetCommandBlocklist: async () => ({ ok: true }),
    aiMcpSetCommandTimeout: async () => ({ ok: true }),
    aiMcpSetMaxIterations: async () => ({ ok: true }),
    aiMcpSetPermissionMode: async () => ({ ok: true }),
    aiMcpSetToolIntegrationMode: async () => ({ ok: true }),
    aiMcpSyncPermissionGrants: async () => ({ ok: true }),
    onMcpApprovalRequest: () => () => {},
    onMcpApprovalCleared: () => () => {},
    respondMcpApproval: async () => ({ ok: true }),
    cancelMcpApprovalTimeout: async () => ({ ok: true }),
    onVaultAgentRequest: () => () => {},
    respondVaultAgent: async () => ({ ok: true }),

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
    setPluginScopeCatalog: async () => ({ ok: true } as any),
    onPluginScopeCatalogChanged: () => () => {},
    setPluginEnvironment: async () => ({ ok: true } as any),
    setPluginInteractionReady: async () => ({ ok: true } as any),
    setPluginPermissionReady: async () => ({ ok: true } as any),
    setPluginAIHostReady: async () => ({ ok: true } as any),
    setPluginAgentHostReady: async () => ({ ok: true } as any),
    updatePluginCredentialCatalog: async () => ({ ok: true } as any),
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
        `ls -1p ${dirPath || '.'} 2>/dev/null | head -n 60`,
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

  window.netcatty = bridge;
}
