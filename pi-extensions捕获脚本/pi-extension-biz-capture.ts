import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const SPOOL_DIR = process.env.PI_BIZ_CAPTURE_SPOOL_DIR || path.join(os.homedir(), '.pi-biz-capture');
const BACKEND_URL = process.env.PI_BIZ_BACKEND_URL || 'http://localhost:3000';
const UPLOAD_SCRIPT = path.join(SPOOL_DIR, 'upload-biz.cjs');

let scanTimer: ReturnType<typeof setInterval> | null = null;

function triggerUpload() {
  try {
    const child = spawn(process.execPath, [UPLOAD_SCRIPT, '--scan-all', BACKEND_URL], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('error', (err) => {
      // 静默处理，不影响 pi 运行
    });
    child.unref();
  } catch {
    // 静默处理
  }
}

function scheduleScanAll() {
  if (scanTimer) return;
  scanTimer = setInterval(() => {
    triggerUpload();
  }, 10 * 60 * 1000);
}

function stopScanAll() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

export default function piBizCaptureExtension(pi: any) {
  pi.on('agent_end', () => {
    triggerUpload();
  });

  pi.on('session_shutdown', (event: any) => {
    triggerUpload();
    const reason = event && event.reason;
    if (reason === 'quit' || reason === 'reload') {
      stopScanAll();
    }
  });

  try {
    process.once('beforeExit', () => { triggerUpload(); stopScanAll(); });
    process.once('SIGINT', () => { triggerUpload(); stopScanAll(); process.exit(0); });
    process.once('SIGTERM', () => { triggerUpload(); stopScanAll(); process.exit(0); });
  } catch {}

  scheduleScanAll();
}
