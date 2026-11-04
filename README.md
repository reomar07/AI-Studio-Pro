# AI Studio Pro

A Windows desktop AI client for local model servers and compatible online providers.

## Features

- Locally stored branching chat history, attachments, prompt templates and exports.
- Local BM25 workspace indexing with status, rebuild and clear controls. Clearing the index does not change your files.
- Web search snippets, or selected-page reading with a disclosure and pre-search confirmation in page-choice mode.
- A Settings hub for appearance, providers, voices, backups, token usage and shortcuts.
- Windows/browser read-aloud and optional downloadable Piper voices.
- Python snippet execution with confirmation. This runs with your account permissions, not in a security sandbox: inspect code first.

## Privacy

Local storage does not mean every request stays offline.

Online AI providers can receive prompts, system instructions, earlier turns, attachment text/images, relevant workspace passages and web content. A separate title request can send part of the initial question. A local server receives requests at its configured endpoint; the app cannot verify whether that server forwards them elsewhere.

Web search sends query words to search services. Selected sites receive requests from your computer and can see your network address. The reader does not execute page JavaScript or log into sites. Enable page-choice mode under Settings > Appearance > Web search to confirm the query before searching. Cancel afterward prevents the AI request, but cannot retract an already-sent search query. With page-choice mode off, Web retains automatic search behavior.

Workspace indexing is local, but retrieved passages can be sent to the AI provider. Piper synthesis runs locally after engine/model installation; downloading voices contacts Hugging Face. System/browser voices may use online services when separately enabled. Missing frontend libraries can be downloaded at startup: include vendor files for offline use.

User data is in `AIStudioPro` under your home folder (normally `%USERPROFILE%\AIStudioPro`), with voice downloads in `offline_voices`. Credentials use Windows Credential Manager when available; the app reports file-based fallback. Do not distribute your user data or credentials.

## Run from source

Use 64-bit Python on Windows and a working WebView2 Runtime. CI currently uses Python 3.12.

```bat
git clone https://github.com/reomar07/AI-Studio-Pro.git
cd AI-Studio-Pro
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
python app-2.py
```

Run once online if vendor libraries are missing. Update the whole source tree together.

## Optional Piper voices

In the same activated environment:

```bat
python -m pip install -r requirements-voices.txt
```

Restart, open Settings > Offline voices, download a model and choose the preferred voice for each language. Preview requires a downloaded model. The catalog has six choices: Lessac/HFC Female medium (English), UPMC/Tom medium (French), Kareem medium/low (Arabic). Kareem low and medium are variants of one speaker. Sizes are estimates.

Installing Piper into Python does not add it to an already-built frozen `.exe`. Build with Piper support below. Dependencies and voice models have separate licenses: review upstream terms, notices and applicable source obligations before redistribution. The app's MIT license does not replace them.

## Build on Windows

```bat
build_exe.bat
build_exe.bat debug
build_exe.bat piper
build_exe.bat piper debug
```

The standard build excludes Piper. The `piper` option installs the optional dependency and collects Piper/ONNX Runtime assets; it still requires Windows runtime testing. `debug` enables console output.

Output: `dist\AI Studio Pro\AI Studio Pro.exe`. Keep the entire application folder together; this is not a single-file build. The build includes a dependency inventory and mode marker, not a complete license bundle or reproducible dependency lock. Do not put user data or voice downloads into the distribution folder.

Install Inno Setup 6, build the app first, then run `build_installer.bat`. Output: `installer\AI_Studio_Pro_Setup.exe`. Vendor sizes are checked inside the built folder. The AppId stays unchanged. App/installer version remains 1.2.1; these changes do not create a newly versioned or signed release.

## Before distributing

1. Confirm CI on the exact commit to ship.
2. Test the built `.exe` on Windows without developer Python dependencies for normal chat/bundled speech.
3. Verify Settings, exports, provider selection and saved preferences after restart.
4. Test both Web cancellation points and rebuild/clear on a disposable workspace.
5. For Piper builds: download, preview, Listen, pause/resume/stop, restart, then test downloaded speech with networking disconnected.
6. Test installation/uninstall on a separate Windows account or machine. Keeping data must preserve it. Choosing deletion can remove the whole app data folder, including voice models.
7. Review third-party redistribution requirements before publishing artifacts.

No Windows build, playback, signing or installer validation is claimed by Linux CI or static checks alone.

## Tests

```bat
python -m unittest discover -s tests -v
node tests/web_index_voices_integration.test.cjs
```

Browser workflows use Playwright and simulated services. Green tests do not prove real audio quality or installer correctness.

## License

Application source: MIT (see LICENSE). Dependencies and voice models: their own upstream licenses; use the library's Model card / license links.
