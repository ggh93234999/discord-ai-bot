@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist .venv (
    echo 第一次執行，建立虛擬環境並安裝套件...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

if not exist .env (
    echo 找不到 .env，請先把 .env.example 複製一份改名成 .env 並填好金鑰。
    pause
    exit /b 1
)

python bot.py
pause
