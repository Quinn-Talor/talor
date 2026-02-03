"""Tests for custom plugin loader."""

import pytest
from pathlib import Path

from src.plugin.loader import PluginLoader, PluginValidationError
from src.plugin.base import PluginPriority


class TestPluginLoader:
    """Tests for PluginLoader."""

    @pytest.fixture
    def loader(self):
        """Create a plugin loader."""
        loader = PluginLoader()
        yield loader
        loader.clear_cache()

    @pytest.fixture
    def valid_plugin_file(self, tmp_path):
        """Create a valid plugin file."""
        plugin_file = tmp_path / "my_plugin.py"
        plugin_file.write_text('''
from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class MyCustomPlugin(PromptPlugin):
    """A custom plugin for testing."""

    def __init__(self):
        super().__init__(
            name="my-custom",
            priority=PluginPriority.CUSTOM,
            enabled=True,
            required=False,
        )

    async def build(self, context: PluginContext) -> PluginResult:
        return PluginResult(
            content="<custom>Hello from custom plugin</custom>",
            section="system",
        )
''')
        return plugin_file

    @pytest.fixture
    def invalid_plugin_file(self, tmp_path):
        """Create an invalid plugin file (missing build method)."""
        plugin_file = tmp_path / "invalid_plugin.py"
        plugin_file.write_text('''
from src.plugin.base import PromptPlugin, PluginPriority


class InvalidPlugin(PromptPlugin):
    """An invalid plugin without build method."""

    def __init__(self):
        super().__init__(
            name="invalid",
            priority=PluginPriority.CUSTOM,
            enabled=True,
            required=False,
        )

    # Missing build method!
''')
        return plugin_file

    def test_load_valid_plugin(self, loader, valid_plugin_file):
        """Test loading a valid plugin."""
        plugin = loader.load_from_file(valid_plugin_file)

        assert plugin is not None
        assert plugin.name == "my-custom"
        assert plugin.priority == PluginPriority.CUSTOM

    def test_load_nonexistent_file(self, loader, tmp_path):
        """Test loading from nonexistent file."""
        plugin = loader.load_from_file(tmp_path / "nonexistent.py")

        assert plugin is None

    def test_load_invalid_extension(self, loader, tmp_path):
        """Test loading file with invalid extension."""
        txt_file = tmp_path / "plugin.txt"
        txt_file.write_text("not a python file")

        plugin = loader.load_from_file(txt_file)

        assert plugin is None

    def test_load_from_directory(self, loader, tmp_path):
        """Test loading plugins from directory."""
        # Create multiple plugin files
        for i in range(3):
            plugin_file = tmp_path / f"plugin_{i}.py"
            plugin_file.write_text(f'''
from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class Plugin{i}(PromptPlugin):
    def __init__(self):
        super().__init__(
            name="plugin-{i}",
            priority=PluginPriority.CUSTOM + {i},
            enabled=True,
            required=False,
        )

    async def build(self, context: PluginContext) -> PluginResult:
        return PluginResult(content="plugin {i}", section="system")
''')

        plugins = loader.load_from_directory(tmp_path)

        assert len(plugins) == 3

    def test_skip_underscore_files(self, loader, tmp_path):
        """Test that files starting with underscore are skipped."""
        # Create a file starting with underscore
        init_file = tmp_path / "__init__.py"
        init_file.write_text("# init file")

        private_file = tmp_path / "_private.py"
        private_file.write_text("# private file")

        plugins = loader.load_from_directory(tmp_path)

        assert len(plugins) == 0

    def test_reload_module(self, loader, tmp_path):
        """Test reloading a plugin module."""
        plugin_file = tmp_path / "reloadable.py"
        plugin_file.write_text('''
from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class ReloadablePlugin(PromptPlugin):
    VERSION = "1.0"

    def __init__(self):
        super().__init__(
            name="reloadable",
            priority=PluginPriority.CUSTOM,
            enabled=True,
            required=False,
        )

    async def build(self, context: PluginContext) -> PluginResult:
        return PluginResult(content=self.VERSION, section="system")
''')

        # Load first version
        plugin1 = loader.load_from_file(plugin_file)
        assert plugin1 is not None

        # Update file
        plugin_file.write_text('''
from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class ReloadablePlugin(PromptPlugin):
    VERSION = "2.0"

    def __init__(self):
        super().__init__(
            name="reloadable",
            priority=PluginPriority.CUSTOM,
            enabled=True,
            required=False,
        )

    async def build(self, context: PluginContext) -> PluginResult:
        return PluginResult(content=self.VERSION, section="system")
''')

        # Reload
        plugin2 = loader.reload_module(plugin_file)
        assert plugin2 is not None


class TestPluginValidation:
    """Tests for plugin validation."""

    @pytest.fixture
    def loader(self):
        """Create a plugin loader."""
        loader = PluginLoader()
        yield loader
        loader.clear_cache()

    def test_validation_missing_name(self, loader, tmp_path):
        """Test validation fails for plugin without name."""
        plugin_file = tmp_path / "no_name.py"
        plugin_file.write_text('''
from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult


class NoNamePlugin(PromptPlugin):
    def __init__(self):
        super().__init__(
            name="",  # Empty name
            priority=PluginPriority.CUSTOM,
            enabled=True,
            required=False,
        )

    async def build(self, context: PluginContext) -> PluginResult:
        return PluginResult(content="", section="system")
''')

        with pytest.raises(PluginValidationError, match="name"):
            loader.load_from_file(plugin_file)

    def test_validation_no_plugin_class(self, loader, tmp_path):
        """Test loading file without plugin class."""
        plugin_file = tmp_path / "no_class.py"
        plugin_file.write_text('''
# Just some Python code without a plugin class
def hello():
    return "world"
''')

        plugin = loader.load_from_file(plugin_file)

        assert plugin is None
