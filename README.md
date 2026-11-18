# @deepwhale-cn/dsh-session-search

跨会话记忆检索：在本机全部 DSH 会话日志（zstd 压缩 JSONL，~/.dsh/sessions）里全文检索——这个话题在哪次会话聊过、当时怎么做的。只读本机、不联网。

```bash
npx @deepwhale-cn/dsh-session-search --keyword 关键词 [--regex] [--workspace 工作区] [--json] [--html 报告.html]
```

按会话聚合（标题/工作区/命中数/样例）；完整还原配合 dsh-agent-forensics；费用统计配合 dsh-token-cost。
