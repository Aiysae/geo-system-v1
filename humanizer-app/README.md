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
5. 启动应用：
   ```bash
   streamlit run app.py
   ```
6. 浏览器会自动打开 `http://localhost:8501`。如果没有自动打开，请手动复制该地址到浏览器。
7. 在左侧面板输入你的 OpenAI API Key，在左侧文本框粘贴初稿，点击"开始清洗"即可。
