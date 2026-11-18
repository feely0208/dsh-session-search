#!/usr/bin/env node
/**
 * dsh-session-search —— 跨会话记忆检索（只读本机，不联网）
 *
 * 用法：
 *   dsh-session-search --keyword 关键词 [--regex] [--workspace 工作区名] [--last-days N]
 *                      [--scope user|assistant|all] [--limit 20] [--root 目录] [--json] [--html 报告.html]
 * 数据源：~/.dsh/sessions（或 DSH_SESSIONS_DIR）。zstd 解压后全文检索 user/assistant 消息。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sessionRoots, listSessions, extractSession, matchKeyword, findZstd } from '../lib/index.js';

const args = process.argv.slice(2);
const has = (k) => args.includes('--' + k);
const val = (k, d = '') => {
  const i = args.indexOf('--' + k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

if (has('help') || !has('keyword')) {
  console.log(`dsh-session-search —— 跨会话记忆检索（只读本机，不联网）

用法：
  dsh-session-search --keyword 关键词 [--regex] [--workspace 工作区名] [--last-days N]
                     [--scope user|assistant|all] [--limit 20] [--root 目录] [--json] [--html 报告.html]

数据源：~/.dsh/sessions 等候选（zstd 压缩 JSONL，与 dsh-token-cost 同源）。
检索范围：user/assistant 消息文本（reasoning 不入索引）+ 会话标题。`);
  process.exit(0);
}

const keyword = val('keyword');
const roots = has('root') ? [resolve(val('root'))] : sessionRoots();
if (!roots.length) { console.error('❌ 未找到 DSH 会话目录（候选：~/.dsh/sessions 等；可用 DSH_SESSIONS_DIR 指定）'); process.exit(2); }

const sessions = listSessions(roots);
if (!sessions.length) { console.error('❌ 会话目录里没有 session.v4.jsonl.zstd 文件'); process.exit(2); }

const workspaceFilter = has('workspace') ? val('workspace') : null;
const lastDays = Number(val('last-days', 0));
const cutoff = lastDays > 0 ? Date.now() - lastDays * 86400000 : 0;
const scope = val('scope', 'all');
const limit = Number(val('limit', 20));

const hits = [];
let scanned = 0, errors = 0;
for (const s of sessions) {
  if (workspaceFilter && !s.workspace.includes(workspaceFilter)) continue;
  scanned += 1;
  try {
    const { title, events } = extractSession(s.zstdPath);
    const texts = events.filter((e) => scope === 'all' || (scope === 'user' && e.type === 'user/message') || (scope === 'assistant' && e.type === 'assistant/message'));
    const matchEvents = [];
    for (const e of texts) {
      const m = matchKeyword(e.text, keyword, { regex: has('regex') });
      for (const h of m) matchEvents.push({ time: e.time, type: e.type, excerpt: h.excerpt });
      if (matchEvents.length >= limit) break;
    }
    if (matchEvents.length) {
      const times = events.map((e) => e.time).filter(Boolean);
      hits.push({ workspace: s.workspace, sessionId: s.sessionId, title: title || '(无标题)', matchCount: matchEvents.length, samples: matchEvents.slice(0, 5), lastTime: times.length ? Math.max(...times) : 0 });
    }
    if (cutoff && events.length && Math.max(...events.map((e) => e.time || 0)) < cutoff) { hits.pop(); }
  } catch (e) {
    errors += 1;
  }
  if (has('json')) continue; // json 模式不打印进度
}
if (has('json')) {
  process.stdout.write(JSON.stringify({ keyword, scanned, errors, hitSessions: hits.length, hits }, null, 2) + '\n', () => process.exit(0));
} else {

console.log(`\n  深鲸 · 跨会话记忆检索：「${keyword}」${has('regex') ? '（正则）' : ''}\n  ${'─'.repeat(60)}`);
console.log(`  扫描会话 ${scanned} 个 · 命中会话 ${hits.length} 个${errors ? ` · 解压失败 ${errors}` : ''}\n`);
if (!hits.length) { console.log('  没有命中。可尝试 --regex 正则、扩大 --last-days 或去掉 --workspace 过滤。\n'); process.exitCode = 0; }
hits.sort((a, b) => b.matchCount - a.matchCount);
for (const h of hits) {
  console.log(`  📌 ${h.title || h.sessionId.slice(0, 8)}  [${h.workspace}]  命中 ${h.matchCount} 处`);
  for (const s of h.samples) console.log(`     · ${s.type === 'user/message' ? '用户' : '助手'}: ${s.excerpt}`);
  console.log('');
}
console.log(`  提示：对命中会话做完整还原可用 dsh-agent-forensics --file 对应 session 文件。`);
}
