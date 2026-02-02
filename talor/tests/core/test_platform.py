"""Tests for the platform adapter module."""

import os
import platform
from pathlib import Path
from unittest.mock import patch

import pytest

from talor.core.platform import (
    Platform,
    PlatformAdapter,
    PTYConfig,
    DirectoryPaths,
    get_platform_adapter,
)


class TestPlatformDetection:
    """Tests for platform detection."""
    
    def test_detect_current_platform(self):
        """Test that current platform is detected correctly."""
        adapter = PlatformAdapter()
        system = platform.system().lower()
        
        if system == "windows":
            assert adapter.platform == Platform.WINDOWS
            assert adapter.is_windows
            assert not adapter.is_unix
        elif system == "darwin":
            assert adapter.platform == Platform.MACOS
            assert adapter.is_macos
            assert adapter.is_unix
        elif system == "linux":
            assert adapter.platform == Platform.LINUX
            assert adapter.is_linux
            assert adapter.is_unix
    
    @patch("platform.system")
    def test_detect_windows(self, mock_system):
        """Test Windows platform detection."""
        mock_system.return_value = "Windows"
        adapter = PlatformAdapter()
        assert adapter.platform == Platform.WINDOWS
        assert adapter.is_windows
        assert not adapter.is_macos
        assert not adapter.is_linux
        assert not adapter.is_unix
    
    @patch("platform.system")
    def test_detect_macos(self, mock_system):
        """Test macOS platform detection."""
        mock_system.return_value = "Darwin"
        adapter = PlatformAdapter()
        assert adapter.platform == Platform.MACOS
        assert adapter.is_macos
        assert not adapter.is_windows
        assert not adapter.is_linux
        assert adapter.is_unix
    
    @patch("platform.system")
    def test_detect_linux(self, mock_system):
        """Test Linux platform detection."""
        mock_system.return_value = "Linux"
        adapter = PlatformAdapter()
        assert adapter.platform == Platform.LINUX
        assert adapter.is_linux
        assert not adapter.is_windows
        assert not adapter.is_macos
        assert adapter.is_unix
    
    @patch("platform.system")
    def test_detect_unknown(self, mock_system):
        """Test unknown platform detection."""
        mock_system.return_value = "FreeBSD"
        adapter = PlatformAdapter()
        assert adapter.platform == Platform.UNKNOWN


class TestDirectoryPaths:
    """Tests for platform-specific directory paths."""
    
    def test_get_directories_returns_directory_paths(self):
        """Test that get_directories returns DirectoryPaths."""
        adapter = PlatformAdapter()
        dirs = adapter.get_directories()
        
        assert isinstance(dirs, DirectoryPaths)
        assert isinstance(dirs.config, Path)
        assert isinstance(dirs.data, Path)
        assert isinstance(dirs.cache, Path)
        assert isinstance(dirs.logs, Path)
    
    def test_directories_contain_talor(self):
        """Test that all directories contain 'talor' in path."""
        adapter = PlatformAdapter()
        dirs = adapter.get_directories()
        
        assert "talor" in str(dirs.config)
        assert "talor" in str(dirs.data)
        assert "talor" in str(dirs.cache)
        assert "talor" in str(dirs.logs)
    
    def test_directories_are_cached(self):
        """Test that directories are cached after first call."""
        adapter = PlatformAdapter()
        dirs1 = adapter.get_directories()
        dirs2 = adapter.get_directories()
        
        assert dirs1 is dirs2
    
    @patch("platform.system")
    def test_linux_xdg_directories(self, mock_system):
        """Test Linux XDG directory paths."""
        mock_system.return_value = "Linux"
        
        with patch.dict(os.environ, {
            "XDG_CONFIG_HOME": "/custom/config",
            "XDG_DATA_HOME": "/custom/data",
            "XDG_CACHE_HOME": "/custom/cache",
        }):
            adapter = PlatformAdapter()
            dirs = adapter.get_directories()
            
            assert dirs.config == Path("/custom/config/talor")
            assert dirs.data == Path("/custom/data/talor")
            assert dirs.cache == Path("/custom/cache/talor")
    
    @patch("platform.system")
    def test_linux_default_directories(self, mock_system):
        """Test Linux default directory paths when XDG not set."""
        mock_system.return_value = "Linux"
        
        # Clear XDG environment variables
        env = {k: v for k, v in os.environ.items() 
               if not k.startswith("XDG_")}
        
        with patch.dict(os.environ, env, clear=True):
            adapter = PlatformAdapter()
            dirs = adapter.get_directories()
            home = Path.home()
            
            assert dirs.config == home / ".config" / "talor"
            assert dirs.data == home / ".local" / "share" / "talor"
            assert dirs.cache == home / ".cache" / "talor"


class TestPTYConfig:
    """Tests for platform-specific PTY configuration."""
    
    def test_get_pty_config_returns_pty_config(self):
        """Test that get_pty_config returns PTYConfig."""
        adapter = PlatformAdapter()
        config = adapter.get_pty_config()
        
        assert isinstance(config, PTYConfig)
        assert isinstance(config.shell, str)
        assert isinstance(config.shell_args, list)
        assert isinstance(config.env_vars, dict)
        assert isinstance(config.use_pty, bool)
        assert isinstance(config.encoding, str)
    
    def test_pty_config_is_cached(self):
        """Test that PTY config is cached after first call."""
        adapter = PlatformAdapter()
        config1 = adapter.get_pty_config()
        config2 = adapter.get_pty_config()
        
        assert config1 is config2
    
    def test_pty_config_has_valid_shell(self):
        """Test that PTY config has a valid shell."""
        adapter = PlatformAdapter()
        config = adapter.get_pty_config()
        
        # Shell should be a non-empty string
        assert config.shell
        assert len(config.shell) > 0
    
    def test_pty_config_encoding_is_utf8(self):
        """Test that PTY config uses UTF-8 encoding."""
        adapter = PlatformAdapter()
        config = adapter.get_pty_config()
        
        assert config.encoding == "utf-8"
    
    @patch("platform.system")
    def test_unix_pty_available(self, mock_system):
        """Test that PTY is available on Unix systems."""
        for system in ["Darwin", "Linux"]:
            mock_system.return_value = system
            adapter = PlatformAdapter()
            config = adapter.get_pty_config()
            
            assert config.use_pty is True
    
    @patch("platform.system")
    def test_windows_pty_not_available(self, mock_system):
        """Test that PTY is not available on Windows."""
        mock_system.return_value = "Windows"
        adapter = PlatformAdapter()
        config = adapter.get_pty_config()
        
        assert config.use_pty is False


class TestPathHandling:
    """Tests for path handling utilities."""
    
    def test_normalize_path_string(self):
        """Test normalizing a path string."""
        adapter = PlatformAdapter()
        path = adapter.normalize_path("some/path")
        
        assert isinstance(path, Path)
        assert path.is_absolute()
    
    def test_normalize_path_object(self):
        """Test normalizing a Path object."""
        adapter = PlatformAdapter()
        path = adapter.normalize_path(Path("some/path"))
        
        assert isinstance(path, Path)
        assert path.is_absolute()
    
    def test_join_path(self):
        """Test joining path components."""
        adapter = PlatformAdapter()
        path = adapter.join_path("dir1", "dir2", "file.txt")
        
        assert isinstance(path, Path)
        assert str(path).endswith("file.txt")
    
    def test_get_path_separator(self):
        """Test getting path separator."""
        adapter = PlatformAdapter()
        sep = adapter.get_path_separator()
        
        assert sep == os.sep
    
    def test_get_env_path_separator(self):
        """Test getting PATH environment variable separator."""
        adapter = PlatformAdapter()
        sep = adapter.get_env_path_separator()
        
        assert sep == os.pathsep
    
    def test_expand_user(self):
        """Test expanding ~ to home directory."""
        adapter = PlatformAdapter()
        path = adapter.expand_user("~/some/path")
        
        assert isinstance(path, Path)
        assert "~" not in str(path)
        assert str(path).startswith(str(Path.home()))
    
    def test_get_home_directory(self):
        """Test getting home directory."""
        adapter = PlatformAdapter()
        home = adapter.get_home_directory()
        
        assert home == Path.home()


class TestProcessManagement:
    """Tests for process management utilities."""
    
    def test_get_executable_extension(self):
        """Test getting executable extension."""
        adapter = PlatformAdapter()
        ext = adapter.get_executable_extension()
        
        if adapter.is_windows:
            assert ext == ".exe"
        else:
            assert ext == ""
    
    def test_find_executable_python(self):
        """Test finding Python executable."""
        adapter = PlatformAdapter()
        python = adapter.find_executable("python3") or adapter.find_executable("python")
        
        # Python should be findable
        assert python is not None
    
    def test_get_process_creation_flags(self):
        """Test getting process creation flags."""
        adapter = PlatformAdapter()
        flags = adapter.get_process_creation_flags()
        
        assert isinstance(flags, int)
        if adapter.is_windows:
            assert flags == 0x08000000  # CREATE_NO_WINDOW
        else:
            assert flags == 0
    
    def test_get_signal_for_terminate(self):
        """Test getting terminate signal."""
        import signal
        
        adapter = PlatformAdapter()
        sig = adapter.get_signal_for_terminate()
        
        assert sig == signal.SIGTERM
    
    def test_get_signal_for_kill(self):
        """Test getting kill signal."""
        import signal
        
        adapter = PlatformAdapter()
        sig = adapter.get_signal_for_kill()
        
        if adapter.is_windows:
            assert sig == signal.SIGTERM
        else:
            assert sig == signal.SIGKILL


class TestPlatformInfo:
    """Tests for platform information."""
    
    def test_get_platform_info(self):
        """Test getting platform information."""
        adapter = PlatformAdapter()
        info = adapter.get_platform_info()
        
        assert isinstance(info, dict)
        assert "platform" in info
        assert "system" in info
        assert "release" in info
        assert "version" in info
        assert "machine" in info
        assert "python_version" in info
    
    def test_platform_info_matches_current(self):
        """Test that platform info matches current system."""
        adapter = PlatformAdapter()
        info = adapter.get_platform_info()
        
        assert info["system"] == platform.system()
        assert info["python_version"] == platform.python_version()


class TestEnsureDirectory:
    """Tests for directory creation."""
    
    def test_ensure_directory_creates_new(self, tmp_path):
        """Test creating a new directory."""
        adapter = PlatformAdapter()
        new_dir = tmp_path / "new_directory"
        
        result = adapter.ensure_directory(new_dir)
        
        assert result == new_dir
        assert new_dir.exists()
        assert new_dir.is_dir()
    
    def test_ensure_directory_existing(self, tmp_path):
        """Test ensuring an existing directory."""
        adapter = PlatformAdapter()
        existing_dir = tmp_path / "existing"
        existing_dir.mkdir()
        
        result = adapter.ensure_directory(existing_dir)
        
        assert result == existing_dir
        assert existing_dir.exists()
    
    def test_ensure_directory_nested(self, tmp_path):
        """Test creating nested directories."""
        adapter = PlatformAdapter()
        nested_dir = tmp_path / "a" / "b" / "c"
        
        result = adapter.ensure_directory(nested_dir)
        
        assert result == nested_dir
        assert nested_dir.exists()


class TestGlobalSingleton:
    """Tests for global singleton instance."""
    
    def test_get_platform_adapter_returns_adapter(self):
        """Test that get_platform_adapter returns a PlatformAdapter."""
        adapter = get_platform_adapter()
        
        assert isinstance(adapter, PlatformAdapter)
    
    def test_get_platform_adapter_returns_same_instance(self):
        """Test that get_platform_adapter returns the same instance."""
        adapter1 = get_platform_adapter()
        adapter2 = get_platform_adapter()
        
        assert adapter1 is adapter2
