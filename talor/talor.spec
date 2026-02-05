# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller Spec File for Talor Backend

This spec file configures PyInstaller to package the Talor backend
into a standalone executable for distribution with the Electron app.

Usage:
    pyinstaller talor.spec

Output:
    dist/talor-backend (or talor-backend.exe on Windows)

Status: Pending implementation
See: talor/docs/phase-3-4-implementation-guide.md for configuration details
"""

block_cipher = None

a = Analysis(
    ['src/cli/main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('prompts', 'prompts'),
    ],
    hiddenimports=[
        'litellm',
        'fastmcp',
        'keyring',
        'pydantic',
        'fastapi',
        'uvicorn',
        'structlog',
        'aiosqlite',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='talor-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# TODO: Test packaging with:
# pyinstaller talor.spec
# dist/talor-backend serve --port 8000
