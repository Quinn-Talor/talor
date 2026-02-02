"""Platform adapter for cross-platform support.

This module provides the PlatformAdapter class for handling platform-specific
behavior across Windows, macOS, and Linux. It provides consistent APIs for:
- Path handling with platform-specific separators
- Configuration directory detection (XDG, AppData, etc.)
- Platform-specific PTY configuration
- Process management

Requirements: 18.1, 18.2, 18.3, 18.4
"""

import os
import platform
import shutil
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any


class Platform(Enum):
    """Supported platforms."""
    WINDOWS = "windows"
    MACOS = "macos"
    LINUX = "linux"
    UNKNOWN = "unknown"


@dataclass
class PTYConfig:
    """Platform-specific PTY configuration.
    
    Attributes:
        shell: Default shell command
        shell_args: Arguments for the shell
        env_vars: Additional environment variables for PTY
        use_pty: Whether PTY is available on this platform
        encoding: Default encoding for PTY output
    """
    shell: str
    shell_args: list[str]
    env_vars: dict[str, str]
    use_pty: bool
    encoding: str


@dataclass
class DirectoryPaths:
    """Platform-specific directory paths.
    
    Attributes:
        config: Configuration directory (e.g., ~/.config/talor)
        data: Data directory (e.g., ~/.local/share/talor)
        cache: Cache directory (e.g., ~/.cache/talor)
        logs: Logs directory (e.g., ~/.local/share/talor/logs)
    """
    config: Path
    data: Path
    cache: Path
    logs: Path


class PlatformAdapter:
    """Adapter for platform-specific behavior.
    
    Provides a consistent interface for platform-specific operations including
    path handling, configuration directories, PTY configuration, and process
    management.
    
    Example:
        ```python
        adapter = PlatformAdapter()
        
        # Get platform info
        print(adapter.platform)  # Platform.MACOS
        
        # Get configuration directories
        dirs = adapter.get_directories()
        print(dirs.config)  # ~/.config/talor
        
        # Normalize paths
        path = adapter.normalize_path("/some/path")
        
        # Get PTY configuration
        pty_config = adapter.get_pty_config()
        ```
    """
    
    def __init__(self) -> None:
        """Initialize the PlatformAdapter.
        
        Automatically detects the current platform and configures
        platform-specific behavior.
        """
        self._platform = self._detect_platform()
        self._directories: DirectoryPaths | None = None
        self._pty_config: PTYConfig | None = None
    
    @property
    def platform(self) -> Platform:
        """Get the current platform.
        
        Returns:
            Platform enum value for the current operating system
        """
        return self._platform
    
    @property
    def is_windows(self) -> bool:
        """Check if running on Windows."""
        return self._platform == Platform.WINDOWS
    
    @property
    def is_macos(self) -> bool:
        """Check if running on macOS."""
        return self._platform == Platform.MACOS
    
    @property
    def is_linux(self) -> bool:
        """Check if running on Linux."""
        return self._platform == Platform.LINUX
    
    @property
    def is_unix(self) -> bool:
        """Check if running on a Unix-like system (macOS or Linux)."""
        return self._platform in (Platform.MACOS, Platform.LINUX)
    
    def _detect_platform(self) -> Platform:
        """Detect the current platform.
        
        Returns:
            Platform enum value
        """
        system = platform.system().lower()
        
        if system == "windows":
            return Platform.WINDOWS
        elif system == "darwin":
            return Platform.MACOS
        elif system == "linux":
            return Platform.LINUX
        else:
            return Platform.UNKNOWN
    
    def get_directories(self) -> DirectoryPaths:
        """Get platform-specific directory paths.
        
        Returns directories following platform conventions:
        - Linux: XDG Base Directory Specification
        - macOS: ~/Library/Application Support and ~/Library/Caches
        - Windows: %APPDATA% and %LOCALAPPDATA%
        
        Returns:
            DirectoryPaths with config, data, cache, and logs directories
        """
        if self._directories is not None:
            return self._directories
        
        if self._platform == Platform.WINDOWS:
            self._directories = self._get_windows_directories()
        elif self._platform == Platform.MACOS:
            self._directories = self._get_macos_directories()
        else:
            # Linux and unknown platforms use XDG
            self._directories = self._get_linux_directories()
        
        return self._directories
    
    def _get_windows_directories(self) -> DirectoryPaths:
        """Get Windows-specific directory paths.
        
        Uses %APPDATA% for config and data, %LOCALAPPDATA% for cache.
        """
        appdata = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        localappdata = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        
        config_dir = appdata / "talor"
        data_dir = appdata / "talor"
        cache_dir = localappdata / "talor" / "cache"
        logs_dir = localappdata / "talor" / "logs"
        
        return DirectoryPaths(
            config=config_dir,
            data=data_dir,
            cache=cache_dir,
            logs=logs_dir
        )
    
    def _get_macos_directories(self) -> DirectoryPaths:
        """Get macOS-specific directory paths.
        
        Uses ~/Library/Application Support for config and data,
        ~/Library/Caches for cache, ~/Library/Logs for logs.
        """
        home = Path.home()
        
        # macOS uses Library directories
        config_dir = home / "Library" / "Application Support" / "talor"
        data_dir = home / "Library" / "Application Support" / "talor"
        cache_dir = home / "Library" / "Caches" / "talor"
        logs_dir = home / "Library" / "Logs" / "talor"
        
        return DirectoryPaths(
            config=config_dir,
            data=data_dir,
            cache=cache_dir,
            logs=logs_dir
        )
    
    def _get_linux_directories(self) -> DirectoryPaths:
        """Get Linux-specific directory paths following XDG specification.
        
        Uses XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME environment
        variables with fallbacks to ~/.config, ~/.local/share, ~/.cache.
        """
        home = Path.home()
        
        # XDG Base Directory Specification
        xdg_config = os.environ.get("XDG_CONFIG_HOME")
        xdg_data = os.environ.get("XDG_DATA_HOME")
        xdg_cache = os.environ.get("XDG_CACHE_HOME")
        
        config_base = Path(xdg_config) if xdg_config else home / ".config"
        data_base = Path(xdg_data) if xdg_data else home / ".local" / "share"
        cache_base = Path(xdg_cache) if xdg_cache else home / ".cache"
        
        return DirectoryPaths(
            config=config_base / "talor",
            data=data_base / "talor",
            cache=cache_base / "talor",
            logs=data_base / "talor" / "logs"
        )
    
    def get_pty_config(self) -> PTYConfig:
        """Get platform-specific PTY configuration.
        
        Returns configuration for pseudo-terminal operations including
        the default shell, arguments, and environment variables.
        
        Returns:
            PTYConfig with platform-appropriate settings
        """
        if self._pty_config is not None:
            return self._pty_config
        
        if self._platform == Platform.WINDOWS:
            self._pty_config = self._get_windows_pty_config()
        elif self._platform == Platform.MACOS:
            self._pty_config = self._get_macos_pty_config()
        else:
            # Linux and unknown platforms
            self._pty_config = self._get_linux_pty_config()
        
        return self._pty_config
    
    def _get_windows_pty_config(self) -> PTYConfig:
        """Get Windows-specific PTY configuration.
        
        Windows uses cmd.exe or PowerShell. PTY support is limited
        on Windows, so we use subprocess instead.
        """
        # Check for PowerShell first, then cmd.exe
        powershell = shutil.which("powershell")
        cmd = shutil.which("cmd")
        
        if powershell:
            shell = powershell
            shell_args = ["-NoLogo", "-NoProfile", "-Command"]
        else:
            shell = cmd or "cmd.exe"
            shell_args = ["/c"]
        
        return PTYConfig(
            shell=shell,
            shell_args=shell_args,
            env_vars={
                "TERM": "dumb",  # Windows doesn't have proper TERM support
            },
            use_pty=False,  # Windows doesn't have native PTY support
            encoding="utf-8"
        )
    
    def _get_macos_pty_config(self) -> PTYConfig:
        """Get macOS-specific PTY configuration.
        
        macOS uses zsh by default (since Catalina) or bash.
        """
        # Check for user's preferred shell
        user_shell = os.environ.get("SHELL", "/bin/zsh")
        
        # Verify shell exists
        if not shutil.which(user_shell):
            user_shell = "/bin/zsh" if shutil.which("/bin/zsh") else "/bin/bash"
        
        return PTYConfig(
            shell=user_shell,
            shell_args=["-c"],
            env_vars={
                "TERM": "xterm-256color",
                "LANG": os.environ.get("LANG", "en_US.UTF-8"),
            },
            use_pty=True,
            encoding="utf-8"
        )
    
    def _get_linux_pty_config(self) -> PTYConfig:
        """Get Linux-specific PTY configuration.
        
        Linux typically uses bash or the user's configured shell.
        """
        # Check for user's preferred shell
        user_shell = os.environ.get("SHELL", "/bin/bash")
        
        # Verify shell exists
        if not shutil.which(user_shell):
            user_shell = "/bin/bash" if shutil.which("/bin/bash") else "/bin/sh"
        
        return PTYConfig(
            shell=user_shell,
            shell_args=["-c"],
            env_vars={
                "TERM": "xterm-256color",
                "LANG": os.environ.get("LANG", "en_US.UTF-8"),
            },
            use_pty=True,
            encoding="utf-8"
        )
    
    def normalize_path(self, path: str | Path) -> Path:
        """Normalize a path for the current platform.
        
        Handles platform-specific path separators and resolves
        the path to an absolute path.
        
        Args:
            path: Path string or Path object to normalize
        
        Returns:
            Normalized Path object
        """
        if isinstance(path, str):
            # Replace forward slashes with platform separator on Windows
            if self._platform == Platform.WINDOWS:
                path = path.replace("/", "\\")
            path = Path(path)
        
        return path.resolve()
    
    def join_path(self, *parts: str | Path) -> Path:
        """Join path components using platform-appropriate separator.
        
        Args:
            *parts: Path components to join
        
        Returns:
            Joined Path object
        """
        return Path(*parts)
    
    def get_path_separator(self) -> str:
        """Get the platform-specific path separator.
        
        Returns:
            Path separator character ('/' or '\\')
        """
        return os.sep
    
    def get_env_path_separator(self) -> str:
        """Get the platform-specific PATH environment variable separator.
        
        Returns:
            PATH separator character (':' or ';')
        """
        return os.pathsep
    
    def expand_user(self, path: str | Path) -> Path:
        """Expand ~ to user's home directory.
        
        Args:
            path: Path that may contain ~
        
        Returns:
            Path with ~ expanded to home directory
        """
        if isinstance(path, str):
            path = Path(path)
        return path.expanduser()
    
    def get_home_directory(self) -> Path:
        """Get the user's home directory.
        
        Returns:
            Path to user's home directory
        """
        return Path.home()
    
    def ensure_directory(self, path: Path) -> Path:
        """Ensure a directory exists, creating it if necessary.
        
        Args:
            path: Directory path to ensure exists
        
        Returns:
            The path that was ensured to exist
        """
        path.mkdir(parents=True, exist_ok=True)
        return path
    
    def get_executable_extension(self) -> str:
        """Get the platform-specific executable extension.
        
        Returns:
            Executable extension ('.exe' on Windows, '' on Unix)
        """
        return ".exe" if self._platform == Platform.WINDOWS else ""
    
    def find_executable(self, name: str) -> str | None:
        """Find an executable in the system PATH.
        
        Args:
            name: Name of the executable to find
        
        Returns:
            Full path to the executable, or None if not found
        """
        # Add .exe extension on Windows if not present
        if self._platform == Platform.WINDOWS and not name.endswith(".exe"):
            result = shutil.which(name + ".exe")
            if result:
                return result
        
        return shutil.which(name)
    
    def get_process_creation_flags(self) -> int:
        """Get platform-specific process creation flags.
        
        Returns flags for subprocess creation that are appropriate
        for the current platform.
        
        Returns:
            Process creation flags (0 on Unix, CREATE_NO_WINDOW on Windows)
        """
        if self._platform == Platform.WINDOWS:
            # CREATE_NO_WINDOW = 0x08000000
            return 0x08000000
        return 0
    
    def get_signal_for_terminate(self) -> int:
        """Get the appropriate signal for terminating a process.
        
        Returns:
            Signal number (SIGTERM on Unix, SIGTERM on Windows via signal module)
        """
        import signal
        return signal.SIGTERM
    
    def get_signal_for_kill(self) -> int:
        """Get the appropriate signal for forcefully killing a process.
        
        Returns:
            Signal number (SIGKILL on Unix, SIGTERM on Windows)
        """
        import signal
        if self._platform == Platform.WINDOWS:
            # Windows doesn't have SIGKILL, use SIGTERM
            return signal.SIGTERM
        return signal.SIGKILL
    
    def get_platform_info(self) -> dict[str, Any]:
        """Get detailed platform information.
        
        Returns:
            Dictionary with platform details including OS, version,
            architecture, and Python version
        """
        return {
            "platform": self._platform.value,
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python_version": platform.python_version(),
            "python_implementation": platform.python_implementation(),
        }


# Global singleton instance
_platform_adapter: PlatformAdapter | None = None


def get_platform_adapter() -> PlatformAdapter:
    """Get the global PlatformAdapter instance.
    
    Returns:
        The singleton PlatformAdapter instance
    """
    global _platform_adapter
    if _platform_adapter is None:
        _platform_adapter = PlatformAdapter()
    return _platform_adapter
