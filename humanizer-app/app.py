import streamlit as st
from openai import OpenAI
import json
import os

# ==========================================
# ⚙️ 全局配置 (在这里固定你的 API 接口)
# ==========================================
# 请将这里的配置替换为你自己的真实 API KEY、URL和模型
API_KEY = "sk-cgvl7cklav7rp1qoykex6w3u129omw4s"  # 填入你的中转站 API KEY
BASE_URL = "https://api.b.ai/v1"   # 填入你的中转站 Base URL (例如 https://api.deepseek.com/v1)
DEFAULT_MODEL = "gpt-5.4-mini"                 # 填入你要默认调用的模型名称
# ==========================================

# Set page config
st.set_page_config(
    page_title="AI 文章去痕迹 (Humanizer)",
    page_icon="✍️",
    layout="wide"
)

# Sidebar
with st.sidebar:
    st.header("⚙️ 设置")
    st.success("✅ API 接口已在系统后台固定，用户无需手动配置，即开即用！")
    st.markdown("---")
    st.markdown("""
    ### 关于
    这是一个将 AI 生成的内容进行"去痕迹"清洗的工具。
    基于 avoid-ai-writing 的核心规则，自动识别并替换常见的 AI 写作特征词汇和句式。

    **功能特性：**
    - 完美支持 Markdown 表格保留
    - 支持一键导出下载 TXT
    - 独立的初稿/洗稿文章 GEO 搜索优化与 EEAT 指标对比检测
    """)

# Main content
st.title("✍️ AI 文章去痕迹 (Humanizer)")
st.markdown("去除 AI 生成文本中的机器感，让文章读起来更自然、更像人类写作。同时评估并优化其在 AI 搜索引擎中的权重。")

@st.cache_data
def load_system_prompt():
    try:
        with open("system_prompt.md", "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return "无法加载系统提示词文件 (system_prompt.md)，请确保它和 app.py 在同一目录下。"

system_prompt = load_system_prompt()

# Initialize session states
if 'output_result' not in st.session_state:
    st.session_state.output_result = ""
if 'input_metrics' not in st.session_state:
    st.session_state.input_metrics = None
if 'output_metrics' not in st.session_state:
    st.session_state.output_metrics = None

# Reusable function for metrics API Call
def get_metrics(text):
    client = OpenAI(api_key=API_KEY, base_url=BASE_URL if BASE_URL else None)
    instructions_metrics = f"""
    作为 SEO 和 GEO（生成引擎优化）专家，请分析以下文章，并严格以 JSON 格式返回分析指标。

    你需要分析的 4 个核心维度：
    1. EEAT 框架符合度 (0-100%)：评估文章是否展现了经验(Experience)、专业度(Expertise)、权威性(Authoritativeness)和可信度(Trustworthiness)。
    2. AIGC 痕迹率 (0-100%)：评估文章中还残留多少 AI 生成的典型特征词汇和句式（越低越好）。
    3. GEO (AI 搜索优化) 抓取率预估 (0-100%)：基于当前结构，被 AI 搜索引擎（如 Perplexity, ChatGPT Search, Gemini）抓取和引用的概率。
    4. 结构优化得分 (0-100%)：评估全文、开头、H1/H2 标题是否符合 GEO 优化结构（如：直入主题、包含核心实体、层级清晰、使用了列表/表格等）。

    【必须且仅返回 JSON 格式数据】，格式参考如下：
    {{
        "eeat_score": 85,
        "aigc_rate": 15,
        "geo_capture_rate": 75,
        "structure_score": 90,
        "analysis_summary": "简短的分析总结"
    }}

    待分析文章：
    {text}
    """
    response = client.chat.completions.create(
        model=DEFAULT_MODEL,
        messages=[
            {"role": "system", "content": "你是一个严谨的 SEO/GEO 数据分析师。必须只输出合法的 JSON 格式。"},
            {"role": "user", "content": instructions_metrics}
        ],
        temperature=0.1
    )

    metrics_str = response.choices[0].message.content
    # Clean up standard Markdown JSON blocks
    if metrics_str.startswith("```json"):
        metrics_str = metrics_str.replace("```json\n", "").replace("\n```", "")
    elif metrics_str.startswith("```"):
        metrics_str = metrics_str.replace("```\n", "").replace("\n```", "")

    return json.loads(metrics_str)

# Reusable function to render metrics UI
def display_metrics(metrics):
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("EEAT 符合度", f"{metrics.get('eeat_score', 0)}%")
    m2.metric("AIGC 痕迹率", f"{metrics.get('aigc_rate', 0)}%", delta="-越低越好", delta_color="inverse")
    m3.metric("GEO 抓取率", f"{metrics.get('geo_capture_rate', 0)}%")
    m4.metric("结构优化得分", f"{metrics.get('structure_score', 0)}%")
    st.info(f"💡 **分析总结：** {metrics.get('analysis_summary', '无')}")

# ==========================================
# 页面布局：初稿输入 与 洗稿输出
# ==========================================
col1, col2 = st.columns(2)

with col1:
    st.subheader("📝 输入 (AI 初稿)")
    input_text = st.text_area("请在此粘贴由 AI 生成的初稿 (支持 Markdown 表格)", height=400, key="input_area")

    # 初稿分析按钮
    if st.button("📊 分析初稿指标", use_container_width=True):
        if not input_text:
            st.warning("⚠️ 请先粘贴初稿文本！")
        else:
            with st.spinner("正在分析初稿的 GEO 与 EEAT 指标..."):
                try:
                    st.session_state.input_metrics = get_metrics(input_text)
                except Exception as e:
                    st.error(f"初稿分析失败，请检查 API 配置或重试。错误信息: {str(e)}")

    # 显示初稿指标
    if st.session_state.input_metrics:
        st.markdown("##### 📉 初稿检测结果")
        display_metrics(st.session_state.input_metrics)

with col2:
    st.subheader("✨ 输出 (洗稿结果)")
    output_text = st.text_area("清洗后的结果：", value=st.session_state.output_result, height=400, key="output_area")

    bcol1, bcol2 = st.columns(2)
    with bcol1:
        if st.session_state.output_result:
            st.download_button("📋 下载清洗结果 (TXT)", data=st.session_state.output_result, file_name="humanized_text.txt", use_container_width=True)
        else:
            st.button("📋 下载清洗结果 (TXT)", disabled=True, use_container_width=True)

    with bcol2:
        if st.button("📊 分析洗稿后指标", use_container_width=True):
            if not st.session_state.output_result:
                st.warning("⚠️ 没有可分析的洗稿结果，请先执行清洗！")
            else:
                with st.spinner("正在分析洗稿结果的 GEO 与 EEAT 指标..."):
                    try:
                        st.session_state.output_metrics = get_metrics(st.session_state.output_result)
                    except Exception as e:
                        st.error(f"洗稿后分析失败，请检查 API 配置或重试。错误信息: {str(e)}")

    # 显示洗稿后指标
    if st.session_state.output_metrics:
        st.markdown("##### 📈 洗稿后检测结果")
        display_metrics(st.session_state.output_metrics)

st.markdown("---")

# ==========================================
# 核心清洗按钮
# ==========================================
_, center_col, _ = st.columns([1, 2, 1])
with center_col:
    if st.button("🚀 开始清洗 (去除 AI 痕迹)", use_container_width=True, type="primary"):
        if not input_text:
            st.warning("⚠️ 请输入需要清洗的文本！")
        else:
            with st.spinner("正在努力去除 AI 痕迹，请稍候..."):
                try:
                    client = OpenAI(api_key=API_KEY, base_url=BASE_URL if BASE_URL else None)
                    instructions_humanize = f"""
                    {system_prompt}

                    请按照上述规则将以下文本进行重写，使其听起来更像人类写作，去除所有 AI 特征（AI-isms）。
                    【重要】如果原文中包含 Markdown 表格，请在重写时务必保留表格结构和格式！
                    只返回清洗后最终的重写结果，不需要返回任何前缀、解释、或者分析过程。

                    需要清洗的文本：
                    {input_text}
                    """

                    response_humanize = client.chat.completions.create(
                        model=DEFAULT_MODEL,
                        messages=[
                            {"role": "system", "content": "你是一个专业的人类编辑。特别注意：请务必完美保留用户输入中的 Markdown 表格格式，不要破坏表格结构。"},
                            {"role": "user", "content": instructions_humanize}
                        ],
                        temperature=0.7,
                    )

                    # 更新结果并清空之前的洗稿指标，触发页面重载
                    st.session_state.output_result = response_humanize.choices[0].message.content
                    st.session_state.output_metrics = None
                    st.rerun()

                except Exception as e:
                    st.error(f"❌ 清洗失败，请检查 API 配置或重试。错误信息：{str(e)}")