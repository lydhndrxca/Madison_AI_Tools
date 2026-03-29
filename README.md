# Madison AI Suite

AI-powered concept art tooling for game development. Built with Electron + React (frontend) and FastAPI + Google Gemini (backend).

## Features

- **AI Character Lab** — Generate, edit, and iterate on character concepts with attribute extraction, style fusion, and multi-view output
- **AI Prop Lab** — Same pipeline for game props (weapons, items, gear)
- **AI Environment Lab** — Environment and scene concept generation
- **AI UI Lab** — Game UI element design and iteration
- **AI Weapon Lab** — Weapon-specific concept art generation
- **Art Table** — Infinite canvas artboard with multi-board support, crop, annotations, and collaborative editing
- **Deep Reference Search** — Gemini-powered image search with Google Search grounding
- **Art Director** — Voice-driven art direction (speak edit instructions, Gemini applies them)
- **Image Editor** — Inpainting, smart erase, outpaint, background removal, style transfer
- **Generation History & Favorites** — Browse, star, and restore any generated image with full metadata
- **Prompt Builder** — Save and reuse custom prompt templates with image references
- **Style Library** — Organize visual style references for consistent generation
- **Export & Handoff** — ZIP packages with all views, metadata, and color palettes

## Prerequisites

- **Windows 10/11**
- **Python 3.9+**
- **Node.js 18+** (includes `npm` and `npx`)
- **Google Gemini API key**

## Setup

1. Clone the repository:
   ```
   git clone <repo-url>
   cd Madison_AI_Tools
   ```

2. Install Python dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Install frontend dependencies:
   ```
   cd frontend
   npm install
   cd ..
   ```

4. Add your Gemini API key:
   - Launch the app and enter it in **Settings**, or
   - Create `config/keys.json`:
     ```json
     { "gemini_api_key": "YOUR_KEY_HERE" }
     ```

## Running

Double-click `run.bat` or run it from a terminal:

```
run.bat
```

This will:
1. Start the FastAPI backend on port **8420**
2. Start the Vite dev server on port **5173**
3. Launch the Electron desktop app

## Project Structure

```
Madison_AI_Tools/
├── electron/              Electron main process
├── frontend/              React SPA (Vite + Tailwind)
│   └── src/
│       ├── components/    UI components (tools, shared, shell, ui)
│       ├── hooks/         React context providers and hooks
│       └── lib/           Utility functions
├── src/
│   └── pubg_madison_ai_suite/
│       └── api/           FastAPI backend
│           ├── server.py  App entry point (19 route modules)
│           ├── core.py    Gemini API wrapper
│           └── routes/    Endpoint modules
├── config/                API keys (gitignored)
├── style_library/         User style references
├── reference_guns/        Weapon reference images
├── run.bat                One-click launcher
├── pyproject.toml         Python build config
└── requirements.txt       Python dependencies
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 35 |
| Frontend | React 19, TypeScript, Tailwind CSS 4, Vite 6 |
| Backend | Python, FastAPI, Uvicorn |
| AI | Google Gemini API (image gen, text, search grounding, function calling) |
| Image processing | Pillow, rembg |
