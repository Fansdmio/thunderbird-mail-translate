# ATN 上架提交清单

## 提交前检查

- [x] 稳定扩展 ID：`mail-translate@uuyo.pw`（勿再改为 local）
- [x] 去掉 `<all_urls>`，微软主机固定声明，自定义 AI 用 optional + 运行时申请
- [x] 中英 locale（`en` 为 default_locale）
- [x] 包内 `privacy.html` 双语隐私政策
- [x] 多尺寸图标与 theme_icons
- [x] `npm test` / `npm run lint` / `npm run pack` 通过
- [ ] 将 `privacy.html` 发布到可公网访问的 HTTPS URL（ATN 隐私政策字段需要）
- [ ] 准备 2–4 张商店截图（PNG）
- [ ] 注册 ATN 开发者账号：https://addons.thunderbird.net/en-US/developers/
- [ ] 上传 `dist/thunderbird-translate-0.1.6.xpi`
- [ ] 粘贴 ATN-LISTING.md 中的 Summary / Description
- [ ] 审核备注粘贴 Listing 中的 Reviewer notes
- [ ] 选择 Listed（公开）或 Unlisted（仅链接安装）

## 本地命令

```powershell
npm test
npm run lint
npm run pack
```

安装包路径：

- `dist/thunderbird-translate-0.1.6.xpi`

## 开发加载注意

扩展 ID 已从 `translate@local.thunderbird` 改为 `mail-translate@uuyo.pw`。
若本机仍装着旧 ID 临时扩展，请先移除再加载新包，避免冲突。

## 隐私政策托管建议

任选其一：

1. GitHub Pages / 个人站点：上传 privacy.html
2. 对象存储静态站（需 HTTPS）
3. 临时：可先 Unlisted 自测；公开 Listed 一般仍需有效隐私 URL

## 审核可能被问到的点

| 问题 | 回答要点 |
|------|----------|
| 为何调用 edge.microsoft.com？ | 默认免 Key 引擎获取临时令牌；设置中可改用 Azure/自建 AI |
| 邮件是否上传到作者服务器？ | 否，无中继 |
| 为何需要 messagesModify？ | 仅在阅读窗替换显示，不改服务器邮件 |
| 自定义 AI 为何可能访问任意站？ | 仅 optional；按用户填写的 Base URL origin 申请 |

## 版本

当前上架目标版本：**0.1.6**