# Puck Chat

Puck Chat 是一个以单页前端和 Node.js 语音中转服务组成的 AI 对话与多媒体工具箱。页面从 cpuck.com 的 wxm 功能迁移而来，保留原有工具布局和移动端体验，移除 Google AdSense 广告代码，并新增豆包实时语音识别（ASR）与语音合成（TTS）。

## 主要功能

### AI 与文本
- OpenAI 兼容 Chat Completions：DeepSeek 文本模型、自定义本地或云端模型端点。
- 图像生成与图生图：GPT Image 2、Hugging Face Qwen Image。
- 浏览器本地对话记忆，支持 JSON 导入、导出和清空。
- Token 与 TK/s 统计、文本计数、重复词统计。
- 自然排版、提炼要点、提链去重、Markdown 预览、HTML 预览。

### 语音
- 麦克风实时录音：点击开始/停止，豆包 ASR 2.0 持续返回识别文字。
- 停止录音后，将最终识别文本追加到输入框，不覆盖已有内容。
- 豆包 TTS 2.0：输入框文字合成为 MP3 并播放；接口不可用时回退到浏览器朗读。
- ASR/TTS API Key 可分别设置；同一 Key 同时开通两项服务时可复用。

### 图像、视频与音频
- 图像预览、EXIF 元数据读取、反色/灰度处理、图像分享。
- 二维码生成与识别。
- 视频按 FPS 抽帧、帧浏览、ZIP 打包，以及视频音轨提取。
- 音频剪辑、选段试听、撤销、增益、淡入淡出、峰值归一化和多格式导出。
- 音频/视频剪辑与转换主要在浏览器本地处理；部分格式使用 FFmpeg WebAssembly。

### 其他
- 网络连通性延迟图表、搜索快捷入口、IP 信息卡片。
- 保留原 wxm 的微信内精简布局和窄屏样式。

## Windows 11 一键安装与启动

仓库提供三个批处理文件，适合 Windows 11 本地运行：

| 文件 | 用途 |
|---|---|
| `install.bat` | 首次安装：检查 Node.js 20+，缺少时尝试通过 winget 安装 Node.js LTS，安装 npm 依赖，创建本地 .env，然后启动网站 |
| `start.bat` | 日常启动：检查运行环境，必要时补装依赖，启动服务并在服务就绪后自动打开浏览器 |
| `update.bat` | 更新代码：执行 git pull --ff-only、npm install 和 server.js 语法检查；保留已有 .env |

**首次使用：**

1. 安装 Git for Windows（如果尚未安装）：https://git-scm.com/download/win
2. 安装或确认已安装 Node.js 20+；`install.bat` 可在 winget 可用时自动安装 Node.js LTS。
3. 克隆仓库：
   ```powershell
   git clone https://github.com/feeday/puck.chat.git
   cd puck.chat
   ```
4. 双击 `install.bat`，等待依赖安装完成，网站会自动启动。
5. 浏览器打开 `http://127.0.0.1:3000`。

**以后使用：** 双击 `start.bat` 启动；需要拉取 GitHub 最新版本时，先关闭正在运行的服务，再双击 `update.bat`，完成后运行 `start.bat`。

说明：
- 如果没有 winget，或自动安装 Node.js 失败，请从 https://nodejs.org/ 安装 Node.js 20 LTS 或更新版本，然后重新运行 `install.bat`。
- 首次安装会从 `.env.example` 创建 `.env`，并将本机监听地址设为 `127.0.0.1`；已有 `.env` 不会被覆盖。
- `update.bat` 仅适用于通过 `git clone` 获取的仓库目录；下载 ZIP 的用户请重新下载最新 ZIP。
- 运行期间请勿关闭启动窗口；按 Ctrl+C 停止服务。
- 需要实时语音识别时，请在浏览器中允许麦克风权限。

## 豆包语音配置

可以在页面底部展开“豆包语音服务设置”，填写 ASR/TTS API Key。Key 保存在当前浏览器 localStorage，仅在发起语音请求时发送给同源 Node.js 服务，不会写入服务器文件。

也可以在服务端 .env 配置 DOUBAO_ASR_API_KEY、DOUBAO_TTS_API_KEY；如果同一个 Key 同时开通 ASR 与 TTS，可配置 DOUBAO_API_KEY 共用。不要将真实 Key 提交到 Git。

默认资源：
- ASR：volc.seedasr.sauc.duration（豆包流式语音识别 2.0 小时版）
- TTS：seed-tts-2.0（豆包语音合成 2.0）
- 默认音色：zh_female_vv_uranus_bigtts

音色 ID 必须是当前账号已开通且有权限使用的音色。若账号使用并发版或其他资源 ID，可在页面设置中修改。

## 中转接口

- GET /api/health：服务健康检查。
- WS /api/asr/ws：浏览器上传 16 kHz、16-bit、单声道 PCM 音频；服务端转发到豆包 bigmodel_async，并回传增量与最终识别结果。
- POST /api/tts：服务端调用豆包 TTS 单向流式 WebSocket，收集音频分片后以 audio/mpeg 返回。

服务端不会记录 API Key、原始音频或识别文本。TTS 路由有基础 IP 频率限制；ASR 每个来源 IP 同时最多建立 3 个连接。若在服务端配置共享 Key 并公开部署，建议额外增加登录或访问控制，避免他人消耗语音额度。

## 部署说明

仓库保留了 puck.chat 的 CNAME。由于 GitHub Pages 只能托管静态文件，不能运行本项目的 Node.js API 和 WebSocket 中转服务，因此完整功能需要部署到支持 Node.js 长期运行的平台或 VPS。

- 安装命令：npm install
- 启动命令：npm start
- Node.js：20+
- 将 puck.chat 域名绑定到 Node.js 服务，并确保 HTTPS 与 WebSocket Upgrade 请求均转发到该服务。
- 若使用反向代理，普通 HTTP 请求和 /api/asr/ws 的 WebSocket 请求都必须转发到 Node 服务端口。

## 数据与隐私

- 对话记忆、模型 API Key、语音设置保存在当前浏览器 localStorage。
- 图像、音视频本地处理功能默认在浏览器中运行；调用文本/图像模型、豆包语音或 Imgur 分享时，相关内容会发送给对应服务商。
- 麦克风只在用户点击“麦克风实时录音”并授权后启用；停止录音后停止音频采集。
- 不要在共享电脑上保存个人 API Key。

## 官方语音文档

- 火山引擎豆包实时语音识别 API：https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh
- 火山引擎豆包 TTS WebSocket 单向流式 API：https://docs.volcengine.com/docs/doubao-voice/unidirectional-streaming-text-to-speech-websocket?lang=zh
