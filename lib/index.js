/**
 * dsh-session-search —— 跨会话记忆检索内核
 *
 * 数据源：本机 DSH 会话日志（与 dsh-token-cost 同源）：
 *   ~/.dsh/sessions/<工作区目录>/session-<uuid>/session.v4.jsonl.zstd
 *   工作区目录名编码了原路径：--Users-mac-DeepSeek~0020Harness-- → /Users/mac/DeepSeek Harness
 * 解压：zstd CLI（DSH_ZSTD_BIN / homebrew / usr 路径候选）。
 * 事件结构（实测快照 2026-11-17）：
 *   user/message      data.content[].text + data.role
 *   assistant/message data.message.content[]（type: text | reasoning，reasoning 不入检索）
 *   session/title     data.title
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function findZstd() {
  const candidates = [process.env.DSH_ZSTD_BIN, '/opt/homebrew/bin/zstd', '/usr/local/bin/zstd', '/usr/bin/zstd'];
  for (const p of candidates) if (p && existsSync(p)) return p;
  return 'zstd';
}

export function sessionRoots() {
  const list = [
    process.env.DSH_SESSIONS_DIR,
    join(homedir(), 'Library', 'Application Support', 'DeepWhale Desktop', 'dsh-home', 'sessions'),
    join(homedir(), '.dsh', 'sessions'),
  ].filter((p) => typeof p === 'string' && p.trim() !== '');
  return list.filter((p) => existsSync(p));
}

/** 工作区目录名 → 原路径（--Users-mac-DeepSeek~0020Harness-- → /Users/mac/DeepSeek Harness） */
/** 与 dsh-token-cost 解码工作区 同源：~XXXX 为十六进制转义（0020=空格），- 为路径分隔 */
export function decodeWorkspace(dirName) {
  let s = String(dirName || '').replace(/^--/, '').replace(/--$/, '');
  s = s.replace(/~([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  const segs = s.split('-').filter((x) => x !== '');
  return '/' + segs.join('/');
}

/** 列出全部会话：[{ workspace, sessionDir, zstdPath }] */
export function listSessions(roots) {
  const out = [];
  for (const root of roots) {
    for (const ws of readdirSync(root, { withFileTypes: true })) {
      if (!ws.isDirectory()) continue;
      const wsDir = join(root, ws.name);
      for (const s of readdirSync(wsDir, { withFileTypes: true })) {
        if (!s.isDirectory()) continue;
        const sDir = join(wsDir, s.name);
        const zstdPath = join(sDir, 'session.v4.jsonl.zstd');
        if (existsSync(zstdPath)) out.push({ workspace: decodeWorkspace(ws.name), workspaceDir: ws.name, sessionDir: sDir, sessionId: s.name.replace(/^session-/, ''), zstdPath });
      }
    }
  }
  return out;
}

/** 解压并抽取会话文本（user/assistant 的 text、title），返回 { title, events: [{type, time, text}] } */
export function extractSession(zstdPath, { maxTextPerEvent = 4000 } = {}) {
  const zstd = process.env.DSH_ZSTD_BIN || findZstd();
  const r = spawnSync(zstd, ['-dc', zstdPath], { encoding: 'utf-8', timeout: 120_000, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('zstd 解压失败：' + (r.stderr || '').slice(0, 160));
  const title = { value: null };
  const events = [];
  for (const line of r.stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let j;
    try { j = JSON.parse(t); } catch { continue; }
    if (j.type === 'session/title' && j.data?.title) title.value = j.data.title;
    let texts = [];
    if (j.type === 'user/message' && Array.isArray(j.data?.content)) {
      texts = j.data.content.filter((c) => c.type === 'text').map((c) => c.text);
    } else if (j.type === 'assistant/message' && Array.isArray(j.data?.message?.content)) {
      texts = j.data.message.content.filter((c) => c.type === 'text').map((c) => c.text); // reasoning 不入检索
    }
    for (const text of texts) {
      events.push({ type: j.type, time: j.time, text: String(text).slice(0, maxTextPerEvent) });
    }
  }
  return { title: title.value, events };
}

/** 关键词命中：返回 { excerpt } 数组（大小写不敏感；--regex 时 keyword 为正则） */
export function matchKeyword(text, keyword, { regex = false } = {}) {
  const hits = [];
  const source = regex ? keyword : keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - 40);
    const excerpt = text.slice(start, Math.min(text.length, m.index + m[0].length + 60)).replace(/\s+/g, ' ');
    hits.push({ index: m.index, excerpt });
    if (hits.length >= 20) break;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return hits;
}

// ── DSH 插件接入（方案 A 薄壳：注册 skill 与 CLI 入口；业务逻辑仍在 lib/bin）──
import { createPlugin, pkgRootFrom } from '@deepwhale-cn/dsh-guard-core/plugin';

export const { name, inject, apply } = createPlugin({
  name: 'session-search',
  pkgRoot: pkgRootFrom(import.meta.url),
  skillFile: 'skill/session-search.md',
  binFile: 'bin/cli.mjs',
  description: "在本机全部 DSH 会话日志（zstd 压缩 JSONL）里全文检索：这个话题在哪次会话聊过、当时怎么做的——找回散落在几十次会话里的解决方案",
  whenToUse: "找回散落在几十次 DSH 会话里的解决方案。用户会说：这个话题之前哪次会话聊过、上次怎么解决的。",
});
