# 🚀 AI Studio Pro

A powerful, privacy-first native desktop AI client for Windows. 

AI Studio Pro is a lightweight `pywebview` application that connects to your favorite local offline models (LM Studio, Ollama) or cloud APIs (OpenRouter, OpenAI) while keeping your data, conversations, and files completely local.

## ✨ Key Features

* **📁 Local Workspace RAG:** Attach local folders to your chat. The app uses an offline BM25 retrieval engine to index PDFs, DOCX, and code files directly in memory without relying on external vector databases.
* **▶️ Local Python Execution:** Safely run LLM-generated Python scripts directly inside the chat interface using your system's Python interpreter.
* **🌐 Live Web Search:** Integrated DuckDuckGo (DDGS) search allows the AI to fetch real-time data and cite live web sources in its answers.
* **🌿 Branching Conversations:** Edit prior prompts and navigate alternative conversation timelines with step controls, backed by a non-linear JSON tree history.
* **📚 Prompt & Persona Library:** Save reusable system prompts and inject them instantly into your workflow.
* **⚙️ Complete Provider Freedom:** Configure custom Base URLs and API keys. Switch seamlessly between cloud inference and fully disconnected local models.

## 🛠️️ Tech Stack
* **Frontend:** HTML5, Tailwind CSS (Dark Mode), Vanilla JavaScript, Marked.js, DOMPurify, Highlight.js
* **Backend:** Python 3, Pywebview
* **AI & Search:** `openai` Python SDK, `rank_bm25`, `duckduckgo-search`
* **Document Parsing:** `PyMuPDF` (PDFs), `python-docx`

## 🚀 Installation & Development

To run this application from the source code, you will need Python 3 installed on your system.

**1. Clone the repository:**
```bash
git clone [https://github.com/your-username/AI-Studio-Pro.git](https://github.com/your-username/AI-Studio-Pro.git)
cd AI-Studio-Pro

**2. Install the required Python packages:**
