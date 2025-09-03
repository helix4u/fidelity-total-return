#!/usr/bin/env python3
"""
Bootstrap: create .venv in the current directory, install deps, then run the app.
Usage:
  python bootstrap.py
"""
import os
import sys
import subprocess
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / ".venv"

def run(cmd, env=None):
    print(">>", " ".join(cmd))
    subprocess.check_call(cmd, env=env)

def ensure_venv():
    if not VENV_DIR.exists():
        print("Creating virtual environment at", VENV_DIR)
        venv.EnvBuilder(with_pip=True, clear=False, upgrade=False).create(str(VENV_DIR))
    else:
        print("Virtual environment already exists at", VENV_DIR)

def pip_path():
    if os.name == "nt":
        return str(VENV_DIR / "Scripts" / "pip.exe")
    return str(VENV_DIR / "bin" / "pip")

def python_path():
    if os.name == "nt":
        return str(VENV_DIR / "Scripts" / "python.exe")
    return str(VENV_DIR / "bin" / "python")

def main():
    ensure_venv()
    req = ROOT / "requirements.txt"
    print("Installing requirements...")
    run([pip_path(), "install", "-r", str(req)])
    print("Launching API server on http://127.0.0.1:8000 ...")
    run([python_path(), "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"])

if __name__ == "__main__":
    main()
