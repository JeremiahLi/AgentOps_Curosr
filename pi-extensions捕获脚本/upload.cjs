const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'upload.log');
const LOCK_FILE = path.join(__dirname, '.uploader.lock');
const CHECKPOINT_FILE = path.join(__dirname, 'uploader_checkpoint.json');

// --scan-all 遍历的 spool 根目录，与捕获插件（pi_extension_capture.ts）保持一致
const SPOOL_ROOT = process.env.PI_CAPTURE_SPOOL_DIR || path.join(os.homedir(), '.linkAI-capture');

// checkpoint 中文件级 stat 条目的保留键（sessionId 为 uuid，不可能叫这个名字）
const FILE_STATS_KEY = '__files__';

// 派生算法版本：mergeToolCalls / buildSessionPayload / 时间锚点修正等派生逻辑变更时必须 +1。
// 作用：读前预检（stat 没变就跳过读盘）会绕过签名重算，若没有版本号，
// 派生算法升级后存量会话将被永远跳过、无法自动重传。版本号不匹配 → 强制全量重读重算。
const DERIVE_VERSION = 4;

// 检查点条目保留时长（天），超过则视为陈旧并剪枝；可用环境变量覆盖
const CHECKPOINT_TTL_MS =
  (Number(process.env.PI_CAPTURE_CHECKPOINT_TTL_DAYS) > 0
    ? Number(process.env.PI_CAPTURE_CHECKPOINT_TTL_DAYS)
    : 30) *
  24 *
  60 *
  60 *
  1000;

function log(msg) {
  console.log(msg);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + msg + '\n');
  } catch (e) {}
}

function safeJsonParse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function readJsonl(file) {
  const records = [];
  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const obj = safeJsonParse(line);
      if (obj) records.push(obj);
    }
  } catch (e) {
    log('readJsonl.error file=' + file + ' ' + (e.message || e));
  }
  return records;
}

// 为记录生成一个稳定、与遍历顺序无关的排序键：
// 优先用 spanId / toolCallId，最后回退到整条记录的序列化
function recordSortKey(r) {
  const id = r.spanId || (r.payload && r.payload.toolCallId) || '';
  let body = '';
  try { body = JSON.stringify(r); } catch (e) { body = String(r); }
  return id + '\u0000' + body;
}

// 按「时间 + 稳定键」做全序排序，消除 readdir 顺序抖动，
// 保证同一份源数据每次生成的 rawData / 签名完全一致
function sortRecordsDeterministic(records) {
  const decorated = records.map(function (rec) {
    const t = new Date(rec.t).getTime();
    return { rec: rec, t: Number.isFinite(t) ? t : 0, key: recordSortKey(rec) };
  });
  decorated.sort(function (a, b) {
    if (a.t !== b.t) return a.t - b.t;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return 0;
  });
  return decorated.map(function (d) { return d.rec; });
}

function mergeToolCalls(records) {
  const toolCallMap = new Map();
  const result = [];
  for (const r of records) {
    if (r.kind === 'tool_execution') {
      const tcId = r.payload && r.payload.toolCallId;
      if (tcId && toolCallMap.has(tcId)) {
        const existing = toolCallMap.get(tcId);
        if (r.payload && r.payload.duration != null) {
          existing.payload = existing.payload || {};
          existing.payload.toolDuration = r.payload.duration;
        }
        if (r.payload && r.payload.isError) {
          existing.status = 'failed';
          existing.payload = existing.payload || {};
          existing.payload.isError = true;
          if (!existing.payload.error && r.payload.error) existing.payload.error = r.payload.error;
          if (!existing.payload.stderr && r.payload.stderr) existing.payload.stderr = r.payload.stderr;
          if (!existing.payload.skillName && r.payload.skillName) existing.payload.skillName = r.payload.skillName;
        }
      }
      continue;
    }
    if (r.kind !== 'tool_call') { result.push(r); continue; }
    const tcId = r.payload && r.payload.toolCallId;
    if (!tcId) { result.push(r); continue; }
    if (!toolCallMap.has(tcId)) {
      toolCallMap.set(tcId, { ...r });
    } else {
      const existing = toolCallMap.get(tcId);
      const mergedInput = existing.payload && existing.payload.input !== undefined ? existing.payload.input : (r.payload ? r.payload.input : undefined);
      const merged = { ...existing, ...r, payload: { ...existing.payload, ...r.payload } };
      if (mergedInput !== undefined && merged.payload && merged.payload.input === undefined) {
        merged.payload.input = mergedInput;
      }
      toolCallMap.set(tcId, merged);
    }
  }
  for (const [, merged] of toolCallMap) { result.push(merged); }
  return sortRecordsDeterministic(result);
}

function stringifyIfExists(val) {
  if (val == null || val === undefined) return null;
  if (typeof val === 'string') return val;
  try { return JSON.stringify(val); } catch { return String(val); }
}

function buildSessionPayload(records) {
  const now = new Date().toISOString();
  const session = {
    sessionID: null, userId: null, projectId: null,
    // 父子链：采集端环境变量链上报（PI_PARENT_SESSION_ID > PI_SESSION_ID 兜底），
    // 每条记录顶层携带，取首个非空值提升到 body。服务端自环守卫兜底。
    parentSessionId: null,
    agentVersion: '',
    agentName: '',
    promptHash: '',
    skillSetHash: '',
    configHash: '',
    startedAt: null, endedAt: null, model: '',
    rawData: JSON.stringify(records), spans: [], piPid: null,
  };
  const modelEvents = [];
  for (const r of records) {
    if (!session.sessionID) session.sessionID = r.sessionID;
    if (!session.userId) session.userId = r.userId;
    if (!session.projectId) session.projectId = r.projectId;
    if (!session.parentSessionId && r.parentSessionId) session.parentSessionId = r.parentSessionId;
    if (r.agentVersion) session.agentVersion = r.agentVersion;
    if (r.promptHash) session.promptHash = r.promptHash;
    if (r.skillSetHash) session.skillSetHash = r.skillSetHash;
    if (r.configHash) session.configHash = r.configHash;
    if (r.payload && r.payload.agent_version) session.agentVersion = r.payload.agent_version;
    if (r.payload && r.payload.agent_name) session.agentName = r.payload.agent_name;
    const ts = r.t || now;
    if (r.kind === 'session_start') {
      session.startedAt = ts;
      if (r.payload && r.payload.pid) session.piPid = r.payload.pid;
      continue;
    }
    if (r.kind === 'session_shutdown') { session.endedAt = ts; continue; }
    if (r.kind === 'model_select') { modelEvents.push(r); continue; }
    // 数值收敛：旧版采集记录的 turnId 可能是字符串（如 "loop-xxx#0"），
    // 服务端 Span.turnId 是 Int 列，直接透传会导致整批 createMany 500。
    var toIntOr = function(v, fb) {
      if (typeof v === 'number' && isFinite(v)) return Math.trunc(v);
      if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Math.trunc(Number(v));
      return fb;
    };
    const span = {
      spanId: r.spanId, kind: r.kind, name: r.name, status: r.status,
      roundIndex: toIntOr(r.roundIndex, 0), turnId: toIntOr(r.turnId, 0),
      input: null, output: null, tokens: null, model: null,
      toolCallId: null, toolName: null, isError: false, error: null, duration: null,
      llmThinkDuration: null, agentReplyDuration: null, toolDuration: null, details: null, content: null, createdAt: ts,
      parentSessionId: r.parentSessionId || null,
      parentId: r.parentId || null,
    };
    if (r.kind === 'user') {
      span.input = r.payload && r.payload.text ? r.payload.text : '';
    } else if (r.kind === 'system_prompt') {
      span.input = r.payload && r.payload.systemPrompt ? r.payload.systemPrompt : '';
    } else if (r.kind === 'llm_thinking') {
      span.input = r.payload && r.payload.thinking ? r.payload.thinking : '';
      span.output = r.payload && r.payload.text ? r.payload.text : '';
      span.tokens = r.payload && r.payload.tokens ? r.payload.tokens : null;
      span.model = r.payload && r.payload.model ? r.payload.model : null;
      if (r.payload && r.payload.timings) {
        span.llmThinkDuration = r.payload.timings.llmThink != null ? r.payload.timings.llmThink : null;
        span.agentReplyDuration = r.payload.timings.agentReply != null ? r.payload.timings.agentReply : null;
      }
      if (r.payload && (r.payload.toolCalls || r.payload.skillName)) {
        span.details = stringifyIfExists({ toolCalls: r.payload.toolCalls || [], skillName: r.payload.skillName || '' });
      }
    } else if (r.kind === 'answer') {
      span.input = r.payload && r.payload.thinking ? r.payload.thinking : '';
      span.output = r.payload && r.payload.text ? r.payload.text : '';
      span.tokens = r.payload && r.payload.tokens ? r.payload.tokens : null;
      span.model = r.payload && r.payload.model ? r.payload.model : null;
      if (r.payload && r.payload.timings) {
        span.llmThinkDuration = r.payload.timings.llmThink != null ? r.payload.timings.llmThink : null;
        span.agentReplyDuration = r.payload.timings.agentReply != null ? r.payload.timings.agentReply : null;
      }
    } else if (r.kind === 'tool_call') {
      span.toolCallId = r.payload && r.payload.toolCallId ? r.payload.toolCallId : null;
      span.toolName = r.name && r.name !== 'tool_call' ? r.name : (r.payload && r.payload.toolName ? r.payload.toolName : null);
      span.input = stringifyIfExists(r.payload && r.payload.input !== undefined ? r.payload.input : null);
      span.output = stringifyIfExists(r.payload && r.payload.output !== undefined ? r.payload.output : null);
      span.isError = !!(r.payload && r.payload.isError) || r.status === 'failed' || r.status === 'error';
      if (r.payload && r.payload.error) span.error = stringifyIfExists(r.payload.error);
      if (r.payload && r.payload.error && !span.output) span.output = stringifyIfExists(r.payload.error);
      if (span.isError && !span.error) span.error = span.output || '工具失败，但没有输出';
      if (r.payload && r.payload.args) {
        var argsText = stringifyIfExists(r.payload.args);
        if (!span.input || span.input === '{}' || span.input === 'null') span.input = argsText;
      }
      if (r.payload && r.payload.stderr && span.error && String(span.error).indexOf(r.payload.stderr) < 0) {
        span.error = String(span.error) + '\n' + r.payload.stderr;
      }
      var detailObj = {};
      if (r.payload && r.payload.details && typeof r.payload.details === 'object') detailObj = Object.assign({}, r.payload.details);
      if (r.payload && r.payload.args) detailObj.args = r.payload.args;
      if (r.payload && r.payload.stderr) detailObj.stderr = r.payload.stderr;
      if (r.payload && r.payload.skillName) detailObj.skillName = r.payload.skillName;
      if (Object.keys(detailObj).length) span.details = stringifyIfExists(detailObj);
      if (r.payload && r.payload.toolDuration != null) span.toolDuration = r.payload.toolDuration;
      if (r.payload && r.payload.content) span.content = stringifyIfExists(r.payload.content);
    }
    if ((r.kind === 'llm_thinking' || r.kind === 'answer') && (r.status === 'failed' || r.status === 'error')) {
      span.isError = true;
      span.error = stringifyIfExists((r.payload && r.payload.error) || span.output || '模型调用失败');
    }
    session.spans.push(span);
  }
  session.spans.sort(function(a, b) { return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); });
  // 时间锚点修正：采集记录的写入时刻是该 span 的「结束」时刻（llm_thinking/answer 在 message_end
  // 写入；tool_call 经 mergeToolCalls 合并后取 tool_result 的写入时刻）。若直接以 createdAt 为起点
  // 向右画 duration，每根条会整体右移自身时长，串行执行会被画成交叠（伪并行）。
  // Pass A：已知真实时长的 span（LLM=agentReply、Tool=toolExecution），把锚点回移到真实开始时刻。
  //   不计入 llmThinkDuration：它依赖跨事件全局变量，可能取到陈旧值导致条形异常膨胀。
  // Pass B：其余 span（user/system_prompt 等，写入时刻即真实开始）按「下一条的修正后开始时刻」补全窗口，
  //   避免其条形延伸到下一条的原始结束时刻、压住修正后的 LLM/Tool 条。
  var KNOWN_DURATION_MAX_MS = 3600000;
  for (var i = 0; i < session.spans.length; i++) {
    var s = session.spans[i];
    var knownDuration = null;
    if ((s.kind === 'llm_thinking' || s.kind === 'answer') && s.agentReplyDuration != null) {
      knownDuration = s.agentReplyDuration;
    } else if (s.kind === 'tool_call' && s.toolDuration != null) {
      knownDuration = s.toolDuration;
    }
    if (knownDuration != null) {
      s.duration = knownDuration;
      if (knownDuration > 0 && knownDuration < KNOWN_DURATION_MAX_MS) {
        s.createdAt = new Date(new Date(s.createdAt).getTime() - knownDuration).toISOString();
      }
      s._needFallbackDuration = false;
    } else {
      s.duration = 0;
      s._needFallbackDuration = true;
    }
  }
  for (var j = 0; j < session.spans.length; j++) {
    var t = session.spans[j];
    if (!t._needFallbackDuration) continue;
    delete t._needFallbackDuration;
    if (j < session.spans.length - 1) {
      var nextStart = new Date(session.spans[j + 1].createdAt).getTime();
      var diff = nextStart - new Date(t.createdAt).getTime();
      t.duration = diff > 0 && diff < KNOWN_DURATION_MAX_MS ? diff : 0;
    } else {
      t.duration = 0;
    }
  }
  var model = '';
  if (modelEvents.length > 0) { model = (modelEvents[modelEvents.length - 1].payload && modelEvents[modelEvents.length - 1].payload.model) || ''; }
  if (!model) { for (const s of session.spans) { if (s.model) { model = s.model; break; } } }
  session.model = model;
  session.endedAt = session.endedAt || now;
  return session;
}

function postJson(targetUrl, payload) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(targetUrl); } catch { resolve({ ok: false, status: 0, body: 'bad url' }); return; }
    const body = Buffer.from(JSON.stringify(payload));
    const options = {
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/api/sessions/upload', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    };
    const reqModule = url.protocol === 'https:' ? https : http;
    const req = reqModule.request(options, (res) => {
      let resBody = '';
      res.on('data', (chunk) => { resBody += chunk; });
      res.on('end', () => { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: resBody }); });
    });
    req.on('error', (err) => { resolve({ ok: false, status: 0, body: err.message }); });
    req.setTimeout(15000, () => { try { req.destroy(); } catch {} resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.end(body);
  });
}

// 从文件路径解析 sessionId 与项目目录，兼容两种命名：
//   pi-<sessionId>-<yyyymmdd>-<hhmmss>.jsonl
//   pi-<sessionId>.jsonl
function parseSessionFile(filePath) {
  const fileName = path.basename(filePath);
  const m = fileName.match(/^pi-(.+)-(\d{8})-(\d{6})\.jsonl$/);
  const sessionId = m ? m[1] : fileName.replace(/^pi-/, '').replace(/-\d{8}-\d{6}\.jsonl$/, '').replace(/\.jsonl$/, '');
  const projectIdDir = path.dirname(path.dirname(filePath));
  return { sessionId, projectIdDir };
}

// 列出该 session 在项目目录下（跨日期目录）的所有 jsonl 文件。
// 只做目录遍历 + 文件名匹配，不读文件内容——供读前预检使用。
function listSessionFiles(projectIdDir, filePattern) {
  const files = [];
  try {
    const dayDirs = fs.readdirSync(projectIdDir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => path.join(projectIdDir, d.name));
    for (const dir of dayDirs) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile()); } catch { continue; }
      for (const entry of entries) {
        if (filePattern.test(entry.name)) {
          files.push(path.join(dir, entry.name));
        }
      }
    }
  } catch (e) { log('listSessionFiles.error ' + (e.message || e)); }
  return files;
}

// 读入一个 session 的全部文件记录，做全序排序并分配全局轮次
function readSessionRecords(sessionFiles) {
  const allRecords = [];
  for (const f of sessionFiles) {
    const recs = readJsonl(f);
    for (const r of recs) allRecords.push(r);
  }
  const ordered = sortRecordsDeterministic(allRecords);
  var globalRound = -1;
  for (var i = 0; i < ordered.length; i++) {
    var r = ordered[i];
    if (r.kind === 'user') globalRound++;
    if (globalRound >= 0) r.roundIndex = globalRound;
  }
  return ordered;
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch { return false; }
}

// 直接对内容做哈希：rawData 是全量记录的序列化，spans 是由记录派生的 span 列表。
// 两者均不含运行时刻（endedAt=now 除外），内容不变则签名恒定、内容一变则签名必变。
// spans 纳入签名：派生算法（如时间锚点修正）变更时签名随之变化，触发存量会话自动重传。
function computeSignature(session) {
  let spansJson = '';
  try { spansJson = JSON.stringify(session.spans); } catch (e) { spansJson = ''; }
  return crypto.createHash('sha1')
    .update(String(session.rawData || ''))
    .update(spansJson)
    .digest('hex');
}

function loadCheckpoint() {
  try {
    if (!fs.existsSync(CHECKPOINT_FILE)) return {};
    const txt = fs.readFileSync(CHECKPOINT_FILE, 'utf8');
    if (!txt || !txt.trim()) return {};
    const obj = JSON.parse(txt);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

function saveCheckpoint(ckpt) {
  try {
    fs.mkdirSync(path.dirname(CHECKPOINT_FILE), { recursive: true });
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(ckpt, null, 2));
  } catch {}
}

// 剪掉陈旧条目：超过 TTL 的，以及旧格式（值为字符串、没有 updatedAt）的条目。
// FILE_STATS_KEY 下是文件级 stat 条目，逐个按同样的 TTL 规则剪枝。
function pruneCheckpoint(ckpt) {
  const now = Date.now();
  const pruned = {};
  let removed = 0;
  for (const id of Object.keys(ckpt)) {
    if (id === FILE_STATS_KEY) {
      const filesMap = ckpt[id];
      const keptFiles = {};
      if (filesMap && typeof filesMap === 'object') {
        for (const fp of Object.keys(filesMap)) {
          const entry = filesMap[fp];
          const updatedAt =
            entry && typeof entry === 'object' && entry.updatedAt ? Date.parse(entry.updatedAt) : NaN;
          if (Number.isFinite(updatedAt) && now - updatedAt <= CHECKPOINT_TTL_MS) {
            keptFiles[fp] = entry;
          } else {
            removed++;
          }
        }
      }
      if (Object.keys(keptFiles).length > 0) pruned[FILE_STATS_KEY] = keptFiles;
      continue;
    }
    const entry = ckpt[id];
    const updatedAt =
      entry && typeof entry === 'object' && entry.updatedAt ? Date.parse(entry.updatedAt) : NaN;
    if (Number.isFinite(updatedAt) && now - updatedAt <= CHECKPOINT_TTL_MS) {
      pruned[id] = entry;
    } else {
      removed++;
    }
  }
  if (removed > 0) {
    log('checkpoint.prune removed=' + removed + ' kept=' + Object.keys(pruned).length);
  }
  return { ckpt: pruned, removed: removed };
}

function getFileStatsMap(ckpt) {
  return ckpt[FILE_STATS_KEY] && typeof ckpt[FILE_STATS_KEY] === 'object' ? ckpt[FILE_STATS_KEY] : {};
}

// 读前预检：所有文件 stat（size + mtimeMs）与 checkpoint 一致 → 视为无变化。
// 只做「快速说 no」（无变化 → 跳过读盘），正确性仍由内容签名兜底：
//   - stat 说有变化但内容其实没变 → 全量读后签名命中，跳过上传，仅刷新 stat；
//   - append 型 jsonl 的 size 不变 ⇒ 内容不变；mtime 额外兜住原地改写。
function filesUnchanged(sessionFiles, filesMap) {
  if (sessionFiles.length === 0) return false;
  for (const f of sessionFiles) {
    let st;
    try { st = fs.statSync(f); } catch { return false; }
    const e = filesMap[f];
    if (!e || e.size !== st.size || e.mtimeMs !== st.mtimeMs) return false;
  }
  return true;
}

// 在读取前对文件做 stat 快照。必须在读取前取：若在上传后取，
// 写入端在上传期间追加的行会被 stat 记为「已上传」，导致下次预检误跳过、丢数据。
function snapshotFileStats(sessionFiles) {
  const snap = {};
  for (const f of sessionFiles) {
    try {
      const st = fs.statSync(f);
      snap[f] = { size: st.size, mtimeMs: st.mtimeMs };
    } catch {}
  }
  return snap;
}

// 把读前快照合并进 checkpoint 的文件级条目（updatedAt 取记录时刻）
function recordFileStats(ckpt, snap) {
  const now = new Date().toISOString();
  const filesMap = getFileStatsMap(ckpt);
  for (const f of Object.keys(snap)) {
    filesMap[f] = { size: snap[f].size, mtimeMs: snap[f].mtimeMs, updatedAt: now };
  }
  ckpt[FILE_STATS_KEY] = filesMap;
}

function acquireLock() {
  try {
    const prevPid = Number((fs.readFileSync(LOCK_FILE, 'utf8') || '').trim());
    if (prevPid && prevPid !== process.pid) {
      try {
        process.kill(prevPid, 0);
        log('lock.skip alreadyRunning pid=' + prevPid);
        return false;
      } catch { /* prevPid dead, takeover */ }
    }
  } catch { /* no lock file */ }
  try { fs.writeFileSync(LOCK_FILE, String(process.pid)); } catch {}
  return true;
}

function releaseLock() {
  try {
    if (Number((fs.readFileSync(LOCK_FILE, 'utf8') || '').trim()) === process.pid) {
      fs.rmSync(LOCK_FILE, { force: true });
    }
  } catch {}
}

// 处理单个会话：预检 → 全量读 → 派生 → 签名比对 → 上传。
// ckpt 由调用方传入并就地更新（scan-all 复用同一份，避免重复读写盘）。
// 返回 'uploaded' | 'skipped' | 'empty' | 'failed'
async function processSession(jsonlFile, backendUrl, ckpt) {
  if (!fs.existsSync(jsonlFile)) { log('upload.skip fileNotFound file=' + jsonlFile); return 'skipped'; }

  const { sessionId, projectIdDir } = parseSessionFile(jsonlFile);
  const escaped = sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 时间戳后缀可选：兼容 pi-<sessionId>.jsonl 旧命名（旧版正则强制要求后缀，导致该类文件永远匹配不到、不上传）
  const filePattern = new RegExp('^pi-' + escaped + '(-\\d{8}-\\d{6})?\\.jsonl$');

  // 会话签名条目兼容三种形态：
  //   { sig, v, updatedAt }（当前） / { sig, updatedAt }（旧版） / 纯字符串 sig（更旧）。
  // 签名比对不受版本限制——重读重算后签名相同就说明 payload 字节级一致，无需重传；
  // 派生算法升级时签名必然变化，逃生口由签名差异本身保证。
  // v（DERIVE_VERSION）只用于读前预检：版本不匹配时禁止「不读盘就跳过」，
  // 强制重读一次以重算签名，让算法升级能在下次触发时生效。
  const prevEntry = ckpt[sessionId];
  const prevSig =
    typeof prevEntry === 'string' ? prevEntry
    : prevEntry && typeof prevEntry === 'object' && typeof prevEntry.sig === 'string' ? prevEntry.sig
    : null;
  const prevVersionOk = prevEntry && typeof prevEntry === 'object' && prevEntry.v === DERIVE_VERSION;

  const sessionFiles = listSessionFiles(projectIdDir, filePattern);

  // 读前预检：stat 全部没变 + 已有同版本签名 → 不读盘直接跳过
  if (prevVersionOk && prevSig && filesUnchanged(sessionFiles, getFileStatsMap(ckpt))) {
    log('upload.skip statsUnchanged sessionId=' + sessionId + ' files=' + sessionFiles.length);
    return 'skipped';
  }

  // 读前快照 stat（必须在读取前取，原因见函数注释）
  const snap = snapshotFileStats(sessionFiles);

  const allRecords = readSessionRecords(sessionFiles);
  log('upload.found sessionId=' + sessionId + ' totalRecords=' + allRecords.length);

  let records = mergeToolCalls(allRecords);
  log('upload.merged records=' + records.length);

  if (records.length === 0) { log('upload.skip empty'); return 'empty'; }

  const session = buildSessionPayload(records);
  log('upload.payload sessionID=' + session.sessionID + ' spans=' + session.spans.length + ' piPid=' + session.piPid);

  const sig = computeSignature(session);
  if (prevSig && prevSig === sig) {
    // 内容没变（可能只是 mtime 抖动 / 首次迁移补 stat）：
    // 会话条目升级到当前派生版本并记录 stat，下次即可走预检跳过、不再读盘
    ckpt[sessionId] = { sig: sig, v: DERIVE_VERSION, updatedAt: new Date().toISOString() };
    recordFileStats(ckpt, snap);
    saveCheckpoint(ckpt);
    log('upload.skip checkpoint unchanged sessionId=' + sessionId + ' sig=' + sig);
    return 'skipped';
  }

  const piAlive = isPidAlive(session.piPid);
  log('upload.pidCheck piPid=' + session.piPid + ' alive=' + piAlive);

  const res = await postJson(backendUrl, session);
  if (res.ok) {
    log('upload.success status=' + res.status + ' body=' + String(res.body).slice(0, 200));
    ckpt[sessionId] = { sig: sig, v: DERIVE_VERSION, updatedAt: new Date().toISOString() };
    recordFileStats(ckpt, snap);
    saveCheckpoint(ckpt);
    log('upload.checkpointUpdated sessionId=' + sessionId + ' sig=' + sig);
    return 'uploaded';
  } else {
    log('upload.failed status=' + res.status + ' body=' + String(res.body).slice(0, 500));
    return 'failed';
  }
}

// --scan-all：遍历 spool 下所有 用户/项目/日期 目录中的会话文件，
// 按项目目录 + sessionId 分组后逐会话处理（配合读前预检，稳态成本只有 readdir + stat）。
// 文件名兼容带/不带时间戳后缀两种命名。
async function scanAll(backendUrl) {
  const files = [];
  try {
    const userDirs = fs.readdirSync(SPOOL_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'logs');
    for (const u of userDirs) {
      const uDir = path.join(SPOOL_ROOT, u.name);
      let projectDirs;
      try { projectDirs = fs.readdirSync(uDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { continue; }
      for (const p of projectDirs) {
        const pDir = path.join(uDir, p.name);
        let dateDirs;
        try { dateDirs = fs.readdirSync(pDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { continue; }
        for (const d of dateDirs) {
          const dDir = path.join(pDir, d.name);
          let entries;
          try { entries = fs.readdirSync(dDir, { withFileTypes: true }).filter((f) => f.isFile()); } catch { continue; }
          for (const e of entries) {
            if (/^pi-.+\.jsonl$/.test(e.name)) {
              files.push(path.join(dDir, e.name));
            }
          }
        }
      }
    }
  } catch (e) {
    log('scanall.scan.error ' + (e.message || e));
  }

  // 同一会话可能跨多个日期目录，按项目目录 + sessionId 分组，每个会话只处理一次
  const groups = new Map();
  for (const f of files) {
    const { sessionId, projectIdDir } = parseSessionFile(f);
    if (!sessionId) continue;
    const key = projectIdDir + '\u0000' + sessionId;
    if (!groups.has(key)) groups.set(key, f);
  }
  log('scanall.found files=' + files.length + ' sessions=' + groups.size);

  const pruned = pruneCheckpoint(loadCheckpoint());
  const ckpt = pruned.ckpt;
  if (pruned.removed > 0) saveCheckpoint(ckpt);

  let uploaded = 0, skipped = 0, failed = 0, empty = 0;
  for (const repFile of groups.values()) {
    const status = await processSession(repFile, backendUrl, ckpt);
    if (status === 'uploaded') uploaded++;
    else if (status === 'failed') failed++;
    else if (status === 'empty') empty++;
    else skipped++;
  }
  log('scanall.done uploaded=' + uploaded + ' skipped=' + skipped + ' empty=' + empty + ' failed=' + failed);
}

async function main() {
  const arg1 = process.argv[2];
  const backendUrl = process.argv[3] || 'http://localhost:3002';

  if (!acquireLock()) { log('upload.skip lockNotAcquired'); process.exit(0); }
  process.on('exit', releaseLock);

  if (arg1 === '--scan-all') {
    log('upload.scanAll backend=' + backendUrl);
    await scanAll(backendUrl);
    process.exit(0);
  }

  if (!arg1) { log('upload.error missing jsonlFile argument'); process.exit(1); }

  log('upload.start file=' + arg1 + ' backend=' + backendUrl);

  const pruned = pruneCheckpoint(loadCheckpoint());
  const ckpt = pruned.ckpt;
  if (pruned.removed > 0) saveCheckpoint(ckpt);

  await processSession(arg1, backendUrl, ckpt);
}

main().catch((err) => {
  log('upload.error ' + (err && err.stack ? err.stack : String(err)));
  process.exit(0);
});
