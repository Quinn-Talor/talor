# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec file for building Talor executable.

Usage:
    pyinstaller talor.spec

This creates a single executable file that includes all dependencies.
"""

import sys
from pathlib import Path

# Get the project root directory
project_root = Path(SPECPATH)

# Analysis configuration
a = Analysis(
    ['talor/cli/main.py'],
    pathex=[str(project_root)],
    binaries=[],
    datas=[
        # Include any data files needed at runtime
        # ('path/to/data', 'destination'),
    ],
    hiddenimports=[
        # Core dependencies
        'talor',
        'talor.core',
        'talor.core.config',
        'talor.core.errors',
        'talor.core.event_bus',
        'talor.core.logging',
        'talor.core.platform',
        'talor.core.storage',
        'talor.services',
        'talor.services.agent',
        'talor.services.auth',
        'talor.services.filesystem',
        'talor.services.lsp',
        'talor.services.mcp',
        'talor.services.permission',
        'talor.services.provider',
        'talor.services.pty',
        'talor.services.session',
        'talor.services.skill',
        'talor.services.worktree',
        'talor.cli',
        'talor.cli.commands',
        'talor.cli.commands.auth',
        'talor.cli.commands.config',
        'talor.cli.commands.mcp',
        'talor.cli.commands.models',
        'talor.cli.commands.run',
        'talor.cli.commands.serve',
        'talor.cli.commands.session',
        # External dependencies that may need explicit import
        'click',
        'pydantic',
        'pydantic_settings',
        'structlog',
        'aiosqlite',
        'yaml',
        'litellm',
        'fastmcp',
        'pygls',
        'ptyprocess',
        'ulid',
        'uvicorn',
        'websockets',
        'fastapi',
        # Async support
        'asyncio',
        'concurrent.futures',
        # Encoding support
        'encodings',
        'encodings.utf_8',
        'encodings.ascii',
        'encodings.latin_1',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude test modules
        'pytest',
        'hypothesis',
        'coverage',
        # Exclude development tools
        'black',
        'ruff',
        'mypy',
        # Exclude documentation tools
        'mkdocs',
        'sphinx',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

# Create PYZ archive
pyz = PYZ(a.pure, a.zipped_data, cipher=None)

# Create executable
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='talor',
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
    icon=None,  # Add icon path here if available: 'assets/icon.ico'
)

# For macOS app bundle (optional)
if sys.platform == 'darwin':
    app = BUNDLE(
        exe,
        name='Talor.app',
        icon=None,  # Add icon path here if available: 'assets/icon.icns'
        bundle_identifier='dev.talor.cli',
        info_plist={
            'CFBundleName': 'Talor',
            'CFBundleDisplayName': 'Talor',
            'CFBundleVersion': '0.1.0',
            'CFBundleShortVersionString': '0.1.0',
            'NSHighResolutionCapable': True,
        },
    )
