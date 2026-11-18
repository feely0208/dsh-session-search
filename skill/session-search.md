# 跨会话记忆检索（dsh-session-search）

**什么时候用**：「这个话题之前在哪次会话聊过」「上次怎么解决的来着」——找回散落在几十次会话里的解决方案。
用户会说：上次怎么解决的、之前哪次会话讨论过 XX。

## 怎么用

```bash
<cli 路径> --keyword 关键词 [--regex] [--workspace 工作区名] [--last-days N] [--json] [--html 报告.html]
```

数据源：~/.dsh/sessions（zstd 压缩 JSONL，与 dsh-token-cost 同源）；检索 user/assistant 消息文本 + 会话标题。

## 边界

- 只读；zstd 解压后全文匹配（大小写不敏感，--regex 正则）
- reasoning 内容不入索引；命中结果按会话聚合，每会话最多展示 5 条样例
- 完整还原用 dsh-agent-forensics --file 对应 session 文件
