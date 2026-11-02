// @ts-nocheck
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

function asBool(v) {
  var s = String(v == null ? '' : v).toLowerCase().trim()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

function asInt(v, fallback) {
  var n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

var SPOOL_DIR = process.env.PI_CAPTURE_SPOOL_DIR || path.join(os.homedir(), '.linkAI-capture')
var USER_ID = process.env.PI_CAPTURE_USER || os.userInfo().username
var MAX_STRING = asInt(process.env.PI_CAPTURE_MAX_STRING, 4000)
var MAX_TOOL_IO = asInt(process.env.PI_CAPTURE_MAX_TOOL_IO, 4000)
var LOG_DIR = path.join(SPOOL_DIR, 'logs')
var PLUGIN_LOG_PATH = path.join(LOG_DIR, 'pi_plugin.log')

function nowIso() {
  return new Date().toISOString()
}

function safeMkdirp(dir) {
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
}

function appendLogLine(file, message) {
  try {
    safeMkdirp(path.dirname(file))
    fs.appendFileSync(file, '[' + nowIso() + '] ' + message + '\n')
  } catch (e) {}
}

function sha1Hex(text) {
  try { return crypto.createHash('sha1').update(String(text)).digest('hex') }
  catch (e) { return '' }
}

function sha256Hex(text) {
  try { return crypto.createHash('sha256').update(String(text)).digest('hex') }
  catch (e) { return '' }
}

/**
 * 失败文本保留尾部。Python Traceback 的异常类型在最后一行，
 * 只截前 4000 字会把根因截掉。
 */
function failureErrorText(text, details, fallback) {
  var body = typeof text === 'string' ? text.trim() : ''
  if (body) {
    if (body.length > 2000) return body.slice(0, 400) + '\n…\n' + body.slice(-1500)
    return body
  }
  var detailText = ''
  if (typeof details === 'string') detailText = details.trim()
  else if (details && typeof details === 'object') {
    try { detailText = JSON.stringify(details) } catch (e) { detailText = '' }
  }
  if (detailText) return detailText.slice(0, 1500)
  return fallback || '工具失败，但没有输出'
}

var SECRET_KEYS = new Set(
  ['apiKey','api_key','apikey','authorization','Authorization',
   'token','accessToken','refreshToken','secret','clientSecret',
   'privateKey','password'].map(function(s){return String(s).toLowerCase()})
)

function isSecretKey(key) {
  var k = String(key || '').toLowerCase()
  if (SECRET_KEYS.has(k)) return true
  if (k.endsWith('_key') || k.endsWith('_token') || k.endsWith('_secret')) return true
  return false
}

function redactJson(value) {
  if (value === null || value === undefined) return value
  var t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return value
  if (Array.isArray(value)) return value.map(redactJson)
  if (t !== 'object') return null
  var out = {}
  var keys = Object.keys(value)
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if (isSecretKey(k)) out[k] = '***'
    else out[k] = redactJson(value[k])
  }
  return out
}

function truncateString(s, max) {
  if (typeof s !== 'string') return s
  if (!Number.isFinite(max) || max <= 0) return ''
  if (s.length <= max) return s
  return s.slice(0, max)
}

function truncateJson(value, maxString) {
  if (value === null || value === undefined) return value
  var t = typeof value
  if (t === 'string') return truncateString(value, maxString)
  if (t === 'number' || t === 'boolean') return value
  if (Array.isArray(value)) return value.map(function(x){return truncateJson(x,maxString)})
  if (t !== 'object') return null
  var out = {}
  var keys = Object.keys(value)
  for (var i = 0; i < keys.length; i++) {
    out[keys[i]] = truncateJson(value[keys[i]], maxString)
  }
  return out
}

function readAgentMeta() {
  try {
    var agentJsonPath = path.join(process.cwd(), '.pi', 'agent.json')
    if (!fs.existsSync(agentJsonPath)) return null
    var data = JSON.parse(fs.readFileSync(agentJsonPath, 'utf-8'))
    return {
      agent_name: data.name || 'pi-coding-agent',
      agent_id: data.agentId || null,
      agent_version: data.version || null,
    }
  } catch (e) {
    return null
  }
}

function safeStringify(value) {
  var seen = []
  try {
    return JSON.stringify(value, function(key, val) {
      if (val === null || val === undefined) return val
      var t = typeof val
      if (t === 'function') return '[Function:' + (val.name || 'anonymous') + ']'
      if (t === 'symbol') return val.toString()
      if (t === 'bigint') return '[BigInt:' + val.toString() + ']'
      if (val instanceof AbortSignal) return '[AbortSignal]'
      if (val instanceof Error) return { __error: val.message, name: val.name }
      if (t === 'object') {
        if (seen.indexOf(val) >= 0) return '[Circular]'
        seen.push(val)
      }
      return val
    })
  } catch (err) {
    return JSON.stringify({ __serializationError: err ? err.message : String(err) })
  }
}

function createWriter(outFile) {
  var stream = null
  var queue = []
  var flushing = false
  var stopped = false
  var pending = null
  var dataWritten = false

  function ensureStream() {
    if (!stream) {
      safeMkdirp(path.dirname(outFile))
      stream = fs.createWriteStream(outFile, { flags: 'a' })
    }
    return stream
  }

  async function flushAsync() {
    if (flushing || stopped) return
    flushing = true
    try {
      var s = ensureStream()
      while (queue.length > 0 && !stopped) {
        var chunk = queue.shift()
        var ok = s.write(chunk)
        if (!ok) {
          await new Promise(function(resolve){ s.once('drain', resolve) })
        }
      }
    } catch (err) {
      appendLogLine(PLUGIN_LOG_PATH, 'writer.flush.error ' + (err && err.message || err))
    }
    flushing = false
  }

  function enqueue(obj) {
    if (stopped) return
    var line
    try { line = safeStringify(obj) + '\n' }
    catch (err) {
      appendLogLine(PLUGIN_LOG_PATH, 'writer.enqueue.stringify.fail kind=' + obj.kind + ' ' + (err && err.message || err))
      return
    }
    queue.push(line)
    dataWritten = true
    if (!pending) {
      pending = setTimeout(function(){ pending = null; flushAsync() }, 0)
      if (pending && pending.unref) pending.unref()
    }
  }

  async function close() {
    if (stopped) return
    try { if (pending) clearTimeout(pending) } catch(e) {}
    try { await flushAsync() } catch(e) {}
    stopped = true
    try { if (stream) stream.end() } catch(e) {}
  }

  function flush(cb) {
    if (flushing) {
      var check = function(){ if (flushing) { setTimeout(check, 10) } else { cb() } }
      check()
      return
    }
    if (queue.length > 0) {
      flushAsync().then(function(){ cb() }).catch(function(){ cb() })
    } else if (stream) {
      stream.write('', function(){ cb() })
    } else {
      cb()
    }
  }

  return {
    enqueue: enqueue,
    close: close,
    flush: flush,
    get outFile() { return outFile },
    get hasData() { return dataWritten }
  }
}

var currentWriter = null
var currentOutFile = null
var currentSessionId = null
var currentProjectId = null
var currentRoundIndex = null
var currentTurnId = null
var currentSessionStartTime = null
var lastProviderRequestTime = null
var lastAssistantMessageStartTime = null
var pendingToolExecutionStart = null

/**
 * 父子链环境变量协议（跨进程 Agent 父子关系）：
 * - 专用变量 PI_PARENT_SESSION_ID：每跳由本扩展在拿到自身 sessionId 后重写为"我是谁"，
 *   子进程（subagent 示例 / bash 嵌套 / RpcClient 均继承 env）看到的就是直系父。
 *   不重写会发生塌缩：孙进程继承的是祖辈的值，中间层消失。
 * - 兜底变量 PI_SESSION_ID：pi 框架 bash 工具 spawn 时默认注入"当前会话 id"
 *   （bash.ts 剥掉继承值再重注入），bash 嵌套启动的 pi 天然拿到直系父。
 * - 优先级：PI_PARENT_SESSION_ID > PI_SESSION_ID；自环守卫：等于自身会话 id 记 null。
 * - adopt 语义：读旧值与重写必须在同一步完成（重写后 env 已变成自身 id，
 *   再读只能靠缓存）。同一会话内只 adopt 一次；resume 换会话时继承链上
 *   残留的上一会话 id，按"同实例延续"语义记为父（v1 简化，量级极低）。
 */
var currentParentSessionId = null
var adoptedForSessionId = null
var lastLlmSpanId = null
var promptHash = ''
var configHash = ''
var agentVersionLabel = ''
var skillHashMap = {}

function noteSkillHash(hash) {
  if (hash) skillHashMap[hash] = true
}

function currentSkillSetHash() {
  var list = Object.keys(skillHashMap).sort()
  if (list.length === 0) return ''
  return sha256Hex(list.join('\n'))
}

function loadReleaseMeta() {
  var meta = readAgentMeta()
  agentVersionLabel = (meta && meta.agent_version) || ''
  try {
    var agentJsonPath = path.join(process.cwd(), '.pi', 'agent.json')
    if (fs.existsSync(agentJsonPath)) configHash = sha256Hex(fs.readFileSync(agentJsonPath, 'utf-8'))
  } catch (e) {}
}
loadReleaseMeta()

function adoptParentChain(sessionId) {
  if (!sessionId) return null
  if (adoptedForSessionId === sessionId) return currentParentSessionId
  var raw = process.env.PI_PARENT_SESSION_ID || process.env.PI_SESSION_ID || null
  currentParentSessionId = (raw && raw !== sessionId) ? raw : null
  if (process.env.PI_PARENT_SESSION_ID !== sessionId) {
    process.env.PI_PARENT_SESSION_ID = sessionId
  }
  adoptedForSessionId = sessionId
  appendLogLine(PLUGIN_LOG_PATH, 'parentenv.adopted sessionId=' + sessionId
    + ' parent=' + (currentParentSessionId || '(none)'))
  return currentParentSessionId
}

function buildOutFile(userId, projectId, sessionId, timestamp) {
  var d = new Date(timestamp || Date.now())
  var yyyy = String(d.getFullYear())
  var mm = String(d.getMonth() + 1).padStart(2, '0')
  var dd = String(d.getDate()).padStart(2, '0')
  var dayDir = path.join(SPOOL_DIR, userId, projectId, yyyy + '-' + mm + '-' + dd)
  var safeSid = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200)
  var ts = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
    + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0')
  return path.join(dayDir, 'pi-' + safeSid + '-' + ts + '.jsonl')
}

function ensureWriter(sessionId, projectId) {
  if (currentSessionId === sessionId && currentWriter) {
    currentProjectId = projectId
    return
  }
  if (currentWriter) {
    triggerUpload('session_switch')
    try { currentWriter.close() } catch(e) {}
  }
  currentSessionId = sessionId
  currentProjectId = projectId
  currentRoundIndex = null
  currentTurnId = null
  lastLlmSpanId = null
  promptHash = ''
  skillHashMap = {}
  // 换会话即 adopt 父链（幂等；覆盖扩展加载晚于 session_start 的时序；
  // session_start 已 adopt 过同一会话时直接用缓存，不会误读被重写的 env）
  adoptParentChain(sessionId)
  if (!currentSessionStartTime) {
    currentSessionStartTime = Date.now()
  }
  currentOutFile = buildOutFile(USER_ID, projectId, sessionId, currentSessionStartTime)
  currentWriter = createWriter(currentOutFile)
  appendLogLine(PLUGIN_LOG_PATH, 'writer.rotated sessionId=' + sessionId + ' file=' + currentOutFile)
}

function closeWriter(reason) {
  if (currentWriter) { try { currentWriter.close() } catch(e) {} }
  currentWriter = null
  currentOutFile = null
  currentSessionId = null
  currentProjectId = null
  currentRoundIndex = null
  currentTurnId = null
  lastLlmSpanId = null
  promptHash = ''
  skillHashMap = {}
  if (reason && (reason.indexOf('quit') >= 0 || reason.indexOf('reload') >= 0 || reason.indexOf('beforeExit') >= 0 || reason.indexOf('SIG') >= 0)) {
    currentSessionStartTime = null
  }
  appendLogLine(PLUGIN_LOG_PATH, 'writer.closed reason=' + reason)
}

function triggerUpload(reason) {
  if (!currentOutFile) return
  if (!currentWriter || !currentWriter.hasData) return
  var uploadScript = process.env.PI_CAPTURE_UPLOAD_SCRIPT || path.join(SPOOL_DIR, 'upload.cjs')
  var backendUrl = process.env.PI_CAPTURE_BACKEND_URL || 'http://localhost:3002'
  appendLogLine(PLUGIN_LOG_PATH, 'upload.trigger reason=' + reason + ' file=' + currentOutFile + ' script=' + uploadScript)
  if (currentWriter.flush) {
    currentWriter.flush(function(){
      spawnUpload(uploadScript, currentOutFile, backendUrl)
    })
  } else {
    spawnUpload(uploadScript, currentOutFile, backendUrl)
  }
}

function spawnUpload(uploadScript, outFile, backendUrl) {
  var child = spawn(process.execPath, [uploadScript, outFile, backendUrl], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env
  })
  child.on('error', function(err) {
    appendLogLine(PLUGIN_LOG_PATH, 'upload.spawn.error ' + (err && err.message || err))
  })
  child.unref()
}

var scanAllTimer = null
var scanAllRunning = false

function scheduleScanAll() {
  if (scanAllTimer) return
  // unref：定时器不能阻止进程退出，否则 pi -p / 嵌套子 pi 完成后进程永远挂住，
  // 父会话的 bash 工具会一直等子 pi 退出，父子链冒烟直接卡死
  scanAllTimer = setInterval(function(){
    if (scanAllRunning) {
      appendLogLine(PLUGIN_LOG_PATH, 'scanall.skip alreadyRunning')
      return
    }
    scanAllRunning = true
    var uploadScript = process.env.PI_CAPTURE_UPLOAD_SCRIPT || path.join(SPOOL_DIR, 'upload.cjs')
    var backendUrl = process.env.PI_CAPTURE_BACKEND_URL || 'http://localhost:3002'
    var child = spawn(process.execPath, [uploadScript, '--scan-all', backendUrl], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: process.env
    })
    child.on('error', function(err) {
      appendLogLine(PLUGIN_LOG_PATH, 'scanall.spawn.error ' + (err && err.message || err))
      scanAllRunning = false
    })
    child.on('exit', function(){
      scanAllRunning = false
    })
    child.unref()
  }, 30000)
  if (scanAllTimer && typeof scanAllTimer.unref === 'function') scanAllTimer.unref()
}

function stopScanAll() {
  if (scanAllTimer) {
    clearInterval(scanAllTimer)
    scanAllTimer = null
  }
}

function spawnScanAll(uploadScript, backendUrl) {
  var child = spawn(process.execPath, [uploadScript, '--scan-all', backendUrl], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env
  })
  child.on('error', function(err) {
    appendLogLine(PLUGIN_LOG_PATH, 'scanall.spawn.error ' + (err && err.message || err))
  })
  child.unref()
}

function writeEvent(event, ctx, kindOverride, nameOverride, statusOverride, payloadOverride) {
  try {
    if (!event || typeof event !== 'object') return
    var kind = kindOverride || event.type
    if (!kind) return
    var sessionId = (ctx && ctx.sessionManager && ctx.sessionManager.getSessionId && ctx.sessionManager.getSessionId()) || (ctx && ctx.sessionId) || null
    if (!sessionId) return
    var cwd = (ctx && ctx.cwd) || (ctx && ctx.sessionManager && ctx.sessionManager.getCwd && ctx.sessionManager.getCwd()) || process.cwd()
    var projectId = sha1Hex(cwd).slice(0, 16)
    var rawPayload;
    if (payloadOverride !== undefined) {
      rawPayload = payloadOverride
    } else {
      var r = {};
      var keys = Object.keys(event);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] !== 'type') r[keys[i]] = event[keys[i]]
      }
      rawPayload = r
    }
    if (rawPayload === null) return
    ensureWriter(sessionId, projectId)
    var tooledPayload = rawPayload
    if (kind === 'tool_call' && rawPayload.input !== undefined) {
      var cp = {};
      Object.keys(rawPayload).forEach(function(k){ cp[k] = rawPayload[k] });
      cp.input = truncateJson(rawPayload.input, MAX_TOOL_IO)
      tooledPayload = cp
    }
    if (kind === 'tool_result') {
      var next = {};
      Object.keys(rawPayload).forEach(function(k){ next[k] = rawPayload[k] });
      if (next.input !== undefined) next.input = truncateJson(next.input, MAX_TOOL_IO)
      if (Array.isArray(next.content)) {
        next.content = next.content.map(function(block){
          if (block && typeof block === 'object' && typeof block.text === 'string') {
            var b = {};
            Object.keys(block).forEach(function(k){ b[k] = block[k] });
            b.text = truncateString(block.text, MAX_TOOL_IO)
            return b
          }
          return block
        })
      }
      tooledPayload = next
    }
    var safePayload = truncateJson(redactJson(tooledPayload), MAX_STRING)
    var record = {
      t: nowIso(),
      userId: USER_ID,
      projectId: projectId,
      sessionID: sessionId,
      roundIndex: currentRoundIndex,
      turnId: currentTurnId,
      spanId: crypto.randomUUID(),
      kind: kind,
      name: nameOverride || kind,
      status: statusOverride || 'success',
      payload: safePayload
    }
    if (currentParentSessionId) record.parentSessionId = currentParentSessionId
    if (agentVersionLabel) record.agentVersion = agentVersionLabel
    if (promptHash) record.promptHash = promptHash
    var skillSetHash = currentSkillSetHash()
    if (skillSetHash) record.skillSetHash = skillSetHash
    if (configHash) record.configHash = configHash
    if ((kind === 'tool_call' || kind === 'tool_execution') && lastLlmSpanId) record.parentId = lastLlmSpanId
    currentWriter.enqueue(record)
    if (kind === 'llm_thinking') lastLlmSpanId = record.spanId
  } catch (err) {
    appendLogLine(PLUGIN_LOG_PATH, 'writeEvent.error kind=' + kind + ' ' + (err && err.message || err))
  }
}

export default function piCaptureExtension(pi) {

  pi.on('session_start', function(event, ctx) {
    // 父子链：读旧 env 值解析父 id（重写前），并把自身 sessionId 重写进链变量供后代继承
    var ownSid = (ctx && ctx.sessionManager && ctx.sessionManager.getSessionId && ctx.sessionManager.getSessionId()) || null
    var parentSessionId = adoptParentChain(ownSid)
    var agentMeta = readAgentMeta()
    var extra = { pid: process.pid, parentSessionId: parentSessionId }
    if (agentMeta) {
      extra.agent_name = agentMeta.agent_name
      extra.agent_id = agentMeta.agent_id
      extra.agent_version = agentMeta.agent_version
    } else {
      extra.agent_name = 'pi-coding-agent'
    }
    writeEvent(event, ctx, 'session_start', 'session_start', 'success', Object.assign({}, event, extra))
  })

  pi.on('agent_end', function(event, ctx) {
    triggerUpload('agent_end')
  })

  pi.on('session_shutdown', function(event, ctx) {
    writeEvent(event, ctx)
    var reason = event && event.reason
    if (reason === 'quit' || reason === 'reload') {
      triggerUpload('session_shutdown:' + reason)
      closeWriter('session_shutdown:' + reason)
    }
  })

  pi.on('turn_start', function(event, ctx) {
    currentTurnId = (event && typeof event.turnIndex === 'number') ? event.turnIndex : null
  })

  pi.on('before_agent_start', function(event, ctx) {
    // 尝试采集工具定义清单（每次请求都会携带，但 usage 不含其构成）：
    // 记录 name + 序列化后字符数，供前端把「工具定义」从其他输入中拆出。defensive：pi API 不存在时跳过。
    var toolsInfo = null
    try {
      var raw = null
      if (typeof pi.getTools === 'function') raw = pi.getTools()
      else if (ctx && Array.isArray(ctx.tools)) raw = ctx.tools
      else if (pi && Array.isArray(pi.tools)) raw = pi.tools
      if (Array.isArray(raw) && raw.length > 0) {
        toolsInfo = raw.map(function(t) {
          var str = typeof t === 'string' ? t : JSON.stringify(t)
          var name = t && typeof t === 'object' ? (t.name || t.function && t.function.name || '?') : '?'
          return { name: name, chars: str.length }
        })
        appendLogLine(PLUGIN_LOG_PATH, 'tools.captured count=' + toolsInfo.length + ' chars=' + toolsInfo.reduce(function(a, t) { return a + t.chars }, 0))
      }
    } catch (e) {
      appendLogLine(PLUGIN_LOG_PATH, 'tools.capture.error ' + (e && e.message || e))
    }
    promptHash = sha256Hex((event && event.systemPrompt) || '')
    writeEvent(event, ctx, 'system_prompt', '系统提示词', 'success', {
      systemPrompt: (event && event.systemPrompt) || '',
      length: ((event && event.systemPrompt) || '').length,
      details: toolsInfo ? { tools: toolsInfo } : undefined
    })
    // promptHash 已在 writeEvent 前写入，后续记录都会带上
  })

  pi.on('input', function(event, ctx) {
    if (currentRoundIndex === null) { currentRoundIndex = 0 } else { currentRoundIndex = currentRoundIndex + 1 }
    currentTurnId = null
    writeEvent(event, ctx, 'user', '用户提问', 'success', { text: (event && event.text) || '' })
    // 检测 /skill: 命令，读取 SKILL.md 内容并写入 JSONL
    if (event && typeof event.text === 'string' && event.text.startsWith('/skill:')) {
      var skillArg = event.text.slice(7).trim()
      var skillName = skillArg.split(' ')[0]
      var commands
      try { commands = pi.getCommands() } catch(e) { appendLogLine(PLUGIN_LOG_PATH, 'skill.getCommands.error ' + (e && e.message || e)); commands = [] }
      var foundPath = null
      for (var i = 0; i < commands.length; i++) {
        var cmd = commands[i]
        if (cmd.source === 'skill' && cmd.name === 'skill:' + skillName) {
          foundPath = cmd.sourceInfo && cmd.sourceInfo.path
          break
        }
      }
      if (foundPath) {
        appendLogLine(PLUGIN_LOG_PATH, 'skill.found name=' + skillName + ' path=' + foundPath)
        try {
          var skillContent = fs.readFileSync(foundPath, 'utf-8')
          noteSkillHash(sha256Hex(skillContent))
          var meta = {}
          // 简单解析 YAML frontmatter 提取 name 和 description
          if (skillContent.slice(0, 3) === '---') {
            var endIdx = skillContent.indexOf('---', 3)
            if (endIdx > 0) {
              var frontmatter = skillContent.slice(3, endIdx).trim()
              var lines = frontmatter.split('\n')
              for (var li = 0; li < lines.length; li++) {
                var line = lines[li]
                var colonIdx = line.indexOf(':')
                if (colonIdx > 0) {
                  var key = line.slice(0, colonIdx).trim()
                  var val = line.slice(colonIdx + 1).trim()
                  meta[key] = val
                }
              }
            }
          }
          writeEvent(event, ctx, 'tool_call', 'skill', 'success', {
            toolCallId: 'skill_read_' + skillName,
            input: { path: foundPath },
            output: skillContent,
            isError: false,
            details: { skillName: meta.name || skillName, description: meta.description || '', triggeredBy: 'user' }
          })
        } catch (err) {
          appendLogLine(PLUGIN_LOG_PATH, 'skill.read.error ' + skillName + ' ' + (err && err.message || err))
          writeEvent(event, ctx, 'tool_call', 'skill', 'failed', {
            toolCallId: 'skill_read_' + skillName,
            input: { path: foundPath },
            isError: true,
            error: (err && err.message) || String(err)
          })
        }
      } else {
        appendLogLine(PLUGIN_LOG_PATH, 'skill.not_found name=' + skillName + ' commands=' + JSON.stringify(commands.map(function(c){return {name:c.name,source:c.source}})))
      }
    }
  })

  pi.on('message_end', function(event, ctx) {
    if (!event || !event.message || event.message.role !== 'assistant') return
    var content = event.message.content || []
    var thinking = ''
    var text = ''
    var toolCalls = []
    for (var i = 0; i < content.length; i++) {
      var c = content[i]
      if (c.type === 'thinking') thinking = c.thinking || ''
      else if (c.type === 'text') text += (c.text || '')
      else if (c.type === 'toolCall') toolCalls.push({ id: c.id, name: c.name, arguments: c.arguments })
    }
    var usage = event.message.usage || {}
    var model = event.message.model || ''
    var isError = event.message.stopReason === 'error'
    var failureText = isError
      ? failureErrorText(event.message.errorMessage || event.message.error || text || thinking, null, '模型调用失败')
      : undefined
    var llmThinkDuration = null
    if (lastProviderRequestTime !== null && lastAssistantMessageStartTime !== null) {
      llmThinkDuration = lastAssistantMessageStartTime - lastProviderRequestTime
    }
    var agentReplyDuration = null
    if (lastAssistantMessageStartTime !== null) {
      agentReplyDuration = Date.now() - lastAssistantMessageStartTime
    }
    var timings = { llmThink: llmThinkDuration, agentReply: agentReplyDuration }
    if (toolCalls.length > 0) {
        writeEvent(event, ctx, 'llm_thinking', 'LLM 思考', isError ? 'failed' : 'success', {
        thinking: thinking, text: text, toolCalls: toolCalls,
        tokens: { input: usage.input || 0, output: usage.output || 0, cacheRead: usage.cacheRead || 0, cacheWrite: usage.cacheWrite || 0, total: usage.totalTokens || 0 },
        model: model, timings: timings, error: failureText
      });
    } else {
      if (thinking) {
      writeEvent(event, ctx, 'llm_thinking', 'LLM 思考', isError ? 'failed' : 'success', {
          thinking: thinking,
          tokens: { input: usage.input || 0, output: usage.output || 0, cacheRead: usage.cacheRead || 0, cacheWrite: usage.cacheWrite || 0, total: usage.totalTokens || 0 },
          model: model, timings: timings, error: failureText
        });
      }
      writeEvent(event, ctx, 'answer', '最终回答', isError ? 'failed' : 'success', {
        text: text,
        tokens: { input: usage.input || 0, output: usage.output || 0, cacheRead: usage.cacheRead || 0, cacheWrite: usage.cacheWrite || 0, total: usage.totalTokens || 0 },
        model: model, timings: timings, error: failureText
      });
    }
  })

  pi.on('tool_call', function(event, ctx) {
    writeEvent(event, ctx, 'tool_call', (event && event.toolName) || 'tool', 'success', {
      toolCallId: event && event.toolCallId, input: (event && event.input) || {}
    })
  })

  pi.on('tool_result', function(event, ctx) {
    var content = (event && event.content) || []
    var text = content.map(function(c){ return c.text || '' }).join('\n')
    var hasNonText = content.some(function(c){ return c && typeof c === 'object' && !c.text })
    var contentPreview = hasNonText ? truncateJson(redactJson(content), MAX_TOOL_IO) : undefined
    var details = (event && event.details) ? truncateJson(redactJson(event.details), MAX_TOOL_IO) : undefined
    // 检测是否是 agent 加载 skill（通过 read 工具读取 SKILL.md）
    var inputPath = (event && event.input && event.input.path) || ''
    var isSkillLoad = inputPath.includes('SKILL.md') || inputPath.includes('skills/')
    var toolName = isSkillLoad ? 'skill' : ((event && event.toolName) || 'tool')
    if (isSkillLoad) {
      details = details || {}
      details.triggeredBy = 'agent'
    }
    if (isSkillLoad && inputPath) {
      try { noteSkillHash(sha256Hex(fs.readFileSync(inputPath, 'utf-8'))) } catch (e) {}
    }
    var failed = !!(event && event.isError)
    var errorText = failed ? failureErrorText(text, details, ((event && event.toolName) || 'tool') + ' 失败，但没有输出') : undefined
    writeEvent(event, ctx, 'tool_call', toolName, failed ? 'failed' : 'success', {
      toolCallId: event && event.toolCallId, input: (event && event.input) || {}, output: text, isError: failed,
      error: errorText, details: details, content: contentPreview
    })
  })

  pi.on('model_select', function(event, ctx) {
    writeEvent(event, ctx, 'model_select', (event && event.model && event.model.id) || 'unknown', 'success', {
      model: (event && event.model && event.model.id) || '',
      previousModel: (event && event.previousModel && event.previousModel.id) || null
    })
  })

  pi.on('before_provider_request', function(event, ctx) {
    lastProviderRequestTime = Date.now()
  })

  pi.on('message_start', function(event, ctx) {
    if (event && event.message && event.message.role === 'assistant') {
      lastAssistantMessageStartTime = Date.now()
    }
  })

  pi.on('tool_execution_start', function(event, ctx) {
    pendingToolExecutionStart = Date.now()
  })

  pi.on('tool_execution_end', function(event, ctx) {
    var toolDuration = null
    if (pendingToolExecutionStart !== null) {
      toolDuration = Date.now() - pendingToolExecutionStart
      pendingToolExecutionStart = null
    }
    var execFailed = !!(event && event.isError)
    writeEvent(event, ctx, 'tool_execution', (event && event.toolName) || 'tool', execFailed ? 'failed' : 'success', {
      toolCallId: event && event.toolCallId,
      toolName: (event && event.toolName) || '',
      duration: toolDuration,
      isError: execFailed,
      error: execFailed ? failureErrorText('', event && event.details, ((event && event.toolName) || 'tool') + ' 执行失败，没有输出') : undefined
    })
  })

  try {
    process.once('beforeExit', function(){ triggerUpload('beforeExit'); closeWriter('beforeExit') })
    process.once('SIGINT', function(){ triggerUpload('SIGINT'); closeWriter('SIGINT'); process.exit(0) })
    process.once('SIGTERM', function(){ triggerUpload('SIGTERM'); closeWriter('SIGTERM'); process.exit(0) })
  } catch(e) {}

  appendLogLine(PLUGIN_LOG_PATH, 'extension.init spoolDir=' + SPOOL_DIR + ' userId=' + USER_ID)
  // 立即跑一次扫描补传积压的 session
  try {
    var uploadScript = process.env.PI_CAPTURE_UPLOAD_SCRIPT || path.join(SPOOL_DIR, 'upload.cjs')
    var backendUrl = process.env.PI_CAPTURE_BACKEND_URL || 'http://localhost:3002'
    spawnScanAll(uploadScript, backendUrl)
    // 之后每 30 秒扫描一次，补传 triggerUpload 漏掉的数据
    scheduleScanAll()
    // 进程退出时清理定时器
    process.once('beforeExit', function(){ stopScanAll() })
    process.once('SIGINT', function(){ stopScanAll() })
    process.once('SIGTERM', function(){ stopScanAll() })
  } catch (e) {}
}