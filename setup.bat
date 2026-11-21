@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Wiveru Setup
cd /d "%~dp0"

echo ============================================
echo   Wiveru — установка
echo ============================================
echo.

REM ---------- 1. Проверка Node.js ----------
echo [1/7] Проверяю Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo   ОШИБКА: Node.js не найден!
  echo   Скачай и установи: https://nodejs.org/  LTS версия
  echo   После установки запусти этот скрипт снова.
  pause
  exit /b 1
)
for /f "tokens=1" %%v in ('node -v') do set NODEV=%%v
echo   Node.js !NODEV! — OK

where npm >nul 2>nul
if errorlevel 1 (
  echo   ОШИБКА: npm не найден идёт в комплекте с Node.js.
  pause
  exit /b 1
)

REM ---------- 2. Проверка Python ----------
echo [2/7] Проверяю Python...
set PYEXE=
python --version >nul 2>nul && set PYEXE=python
if not defined PYEXE (
  py --version >nul 2>nul && set PYEXE=py
)
if not defined PYEXE (
  echo   ОШИБКА: Python не найден!
  echo   Скачай и установи: https://www.python.org/downloads/
  echo   ВАЖНО: при установке поставь галочку «Add python.exe to PATH».
  pause
  exit /b 1
)
for /f "tokens=2" %%v in ('!PYEXE! --version') do set PYV=%%v
echo   Python !PYV! — OK

REM ---------- 3. npm install ----------
echo [3/7] Устанавливаю зависимости npm install...
call npm install
if errorlevel 1 (
  echo   ОШИБКА: npm install завершился с ошибкой. Проверь интернет и Node.js.
  pause
  exit /b 1
)

REM ---------- 4. Модели ----------
echo [4/7] Подготавливаю модели...
if not exist models mkdir models

set GDIR=models\gigaam\sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16
if exist "%GDIR%\model.int8.onnx" (
  echo   GigaAM STT уже скачана — пропускаю.
) else (
  echo   Скачиваю GigaAM STT около 225 МБ, может занять время...
  if not exist "%GDIR%" mkdir "%GDIR%"
  curl.exe -fSL --retry 3 -o "%GDIR%\model.int8.onnx" "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16/resolve/main/model.int8.onnx"
  if errorlevel 1 (
    echo   ОШИБКА: не удалось скачать model.int8.onnx
    echo   Скачай вручную: https://huggingface.co/csukuangfj/sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16
    pause
    exit /b 1
  )
  curl.exe -fSL --retry 3 -o "%GDIR%\tokens.txt" "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16/resolve/main/tokens.txt"
  if errorlevel 1 (
    echo   ОШИБКА: не удалось скачать tokens.txt
    pause
    exit /b 1
  )
  echo   GigaAM STT — OK
)

REM ---------- 5. Python venv + sherpa-onnx ----------
echo [5/7] Создаю Python-окружение для STT...
if exist stt-venv\Scripts\python.exe (
  echo   stt-venv уже существует — пропускаю создание.
) else (
  !PYEXE! -m venv stt-venv
  if errorlevel 1 (
    echo   ОШИБКА: не удалось создать venv. Проверь, что Python установлен корректно.
    pause
    exit /b 1
  )
)
stt-venv\Scripts\python.exe -m pip install --upgrade pip >nul 2>nul
stt-venv\Scripts\python.exe -m pip install sherpa-onnx
if errorlevel 1 (
  echo   ОШИБКА: не удалось установить sherpa-onnx в venv.
  echo   Можно доустановить вручную: stt-venv\Scripts\pip install sherpa-onnx
  pause
  exit /b 1
)
echo   stt-venv + sherpa-onnx — OK

REM ---------- 6. Конфиги ----------
echo [6/7] Настраиваю конфиги...
if not exist ai-config.json copy /y ai-config.example.json ai-config.json >nul
if not exist settings.json copy /y settings.example.json settings.json >nul
echo   ai-config.json, settings.json — OK

REM ---------- 7. LLM модель (опционально) ----------
echo [7/7] Локальная ИИ-модель...
if exist models\*.gguf (
  echo   GGUF-модель уже есть — пропускаю.
) else (
  echo   GGUF-модель не найдена. Без неё голосовой ИИ работать не будет,
  echo   но облачные провайдеры Pollinations/OpenAI/Gemini работают и так.
  echo.
  set /p DLQ="   Скачать Qwen3-4B-Instruct (~2.5 ГБ) сейчас? [y/N]: "
  if /i "!DLQ!"=="y" (
    echo   Скачиваю Qwen3-4B Q4_K_M...
    curl.exe -fSL --retry 3 -o "models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf" "https://huggingface.co/lmstudio-community/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
    if errorlevel 1 (
      echo   ОШИБКА: не удалось скачать GGUF. Скачай вручную с HuggingFace в папку models\
    ) else (
      echo   GGUF — OK
    )
  ) else (
    echo   Пропущено. Модель можно докачать позже в models\
  )
)

echo.
echo ============================================
echo   Установка завершена!
echo   Запустите Wiveru через: npm start
echo ============================================
pause
