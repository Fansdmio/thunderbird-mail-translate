# Thunderbird 邮件翻译

阅读收到的邮件时，一键将主题与正文全文替换为译文，并支持原文/译文切换。

## 功能

- 手动翻译当前邮件（主题 + 正文）
- 尽量保留 HTML 结构
- 一键切换原文 ⇄ 译文（不修改服务器上的原邮件）
- 默认微软翻译（免配置）
- 可选 Azure 官方 / 自定义 OpenAI 兼容 AI
- AI 引擎将多段文本合并为**一次对话**批量翻译（JSON 数组），减少请求次数与耗时
- 目标语言在设置页全局选择
- 切换邮件时按钮状态自动同步

## 目录结构

```
├── manifest.json              # 扩展清单
├── _locales/                  # 本地化
├── src/
│   ├── background/            # 后台：调度、引擎、翻译服务
│   │   ├── background.js
│   │   ├── translate-service.js
│   │   └── providers/         # 微软免 Key / Azure / OpenAI 兼容
│   ├── content/               # 阅读窗脚本
│   ├── options/               # 设置页
│   ├── shared/                # 设置、语言、HTML 文本处理
│   └── icons/
├── tests/                     # 单元测试
├── scripts/pack.js            # 打包脚本
├── dist/                      # 安装包（xpi/zip/jar）
└── docs/                      # 设计与实施文档
```

## 安装

**开发加载：** Thunderbird → 附加组件 → 齿轮 → 调试附加组件 → 临时加载 → 选择本仓库 `manifest.json`

**安装包：** 使用 `dist/thunderbird-translate-*.xpi`，附加组件 → 从文件安装

## 使用

1. 打开一封邮件
2. 点击阅读窗工具栏「翻译」
3. 按钮变为「显示原文」，可来回切换
4. 切换到其他邮件时按钮会自动恢复为「翻译」（若该邮件本会话译过则为「显示译文」）

## 设置

附加组件选项中可配置：

- 翻译引擎：微软免配置 / Azure / 自定义 AI
- 目标语言
- Azure 密钥与区域
- AI 的 Base URL、API Key、模型 ID
- 测试连接

## 开发

```powershell
npm install
npm test
npm run pack
```

## 隐私

- 邮件内容仅发送到你选择的翻译服务
- API Key 只保存在本机
- 本扩展不经过作者中继服务器

## 限制

- 微软免 Key 接口为非官方端点，可能变更或限流
- 不支持写信翻译、自动翻译、对照模式
