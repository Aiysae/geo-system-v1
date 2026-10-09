# AI 文章去痕迹 (Humanizer)

这是一个本地运行的 Streamlit 网页应用，用于将 AI 生成的文章内容进行"去痕迹"清洗。它基于 [avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing) 仓库中的核心规则，通过调用 OpenAI API 来重新润色文本，使其读起来更加自然、具有人类写作的特点。

## 如何运行

1. 确保你的电脑已安装 Python (建议 Python 3.8 或以上版本)
2. 打开终端，进入本项目目录：
   ```bash
   cd /Users/mac/Desktop/humanizer-app
   ```
3. (可选但推荐) 创建并激活虚拟环境：
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
4. 安装所需依赖：
   ```bash
   pip install -r requirements.txt
   ```
5. 在当前终端输入供应商后台新建的 API Key，再启动应用。输入不会回显，也不会作为命令写入 shell 历史：
   ```bash
   read -r -s HUMANIZER_API_KEY
   export HUMANIZER_API_KEY
   streamlit run app.py
   ```
   密钥通过 `HUMANIZER_API_KEY` 环境变量读取；缺少配置时页面提示管理员配置，并停止执行。终端中按回车完成密钥输入。
   当前服务地址为 `https://api.b.ai/v1`，请使用该服务的密钥。部署时通过运行环境的密钥配置传入相同变量。
6. 浏览器会自动打开 `http://localhost:8501`。如果没有自动打开，请手动复制该地址到浏览器。
7. 在左侧文本框粘贴初稿，点击"开始清洗"即可。

## 旧密钥处置

旧版本曾将 API Key 写入 Git。移除源码中的值不会使旧密钥失效：替代密钥配置并验证正常后，应在供应商后台撤销旧密钥；若有异常调用，应优先撤销。完整密钥不要写入代码、文档或提交。
