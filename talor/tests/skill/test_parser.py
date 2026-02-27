"""Tests for SkillParser."""

import pytest
from pathlib import Path
import tempfile

from src.skill.parser import SkillParser, SkillInfo


class TestSkillParser:
    """Tests for SkillParser."""

    def test_parse_valid_skill(self, tmp_path):
        """Test parsing a valid SKILL.md file."""
        skill_md = tmp_path / "SKILL.md"
        skill_md.write_text("""---
name: test-skill
description: A test skill for unit testing
allowed-tools: read, write, bash
---

# Test Skill Instructions

This is the instruction content.
""")
        skill = SkillParser.parse(skill_md)

        assert skill is not None
        assert skill.name == "test-skill"
        assert skill.description == "A test skill for unit testing"
        assert skill.allowed_tools == ["read", "write", "bash"]
        assert "Test Skill Instructions" in skill.instructions

    def test_parse_without_allowed_tools(self, tmp_path):
        """Test parsing skill without allowed-tools."""
        skill_md = tmp_path / "SKILL.md"
        skill_md.write_text("""---
name: simple-skill
description: A simple skill
---

Instructions here.
""")
        skill = SkillParser.parse(skill_md)

        assert skill is not None
        assert skill.name == "simple-skill"
        assert skill.allowed_tools is None

    def test_parse_missing_name_uses_dir_name(self, tmp_path):
        """Test parsing skill without name falls back to directory name."""
        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()
        skill_md = skill_dir / "SKILL.md"
        skill_md.write_text("""---
description: Missing name falls back to dir
---

Content.
""")
        skill = SkillParser.parse(skill_md)

        assert skill is not None
        assert skill.name == "my-skill"

    def test_parse_missing_description_uses_first_paragraph(self, tmp_path):
        """Test parsing skill without description falls back to first paragraph."""
        skill_md = tmp_path / "SKILL.md"
        skill_md.write_text("""---
name: no-description
---

This is the first paragraph used as description.

More content here.
""")
        skill = SkillParser.parse(skill_md)

        assert skill is not None
        assert "first paragraph" in skill.description

    def test_parse_no_frontmatter(self, tmp_path):
        """Test parsing file without frontmatter fails."""
        skill_md = tmp_path / "SKILL.md"
        skill_md.write_text("""# Just markdown

No frontmatter here.
""")
        skill = SkillParser.parse(skill_md)

        assert skill is None

    def test_parse_nonexistent_file(self, tmp_path):
        """Test parsing nonexistent file returns None."""
        skill_md = tmp_path / "nonexistent.md"
        skill = SkillParser.parse(skill_md)

        assert skill is None

    def test_parse_allowed_tools_as_list(self, tmp_path):
        """Test parsing allowed-tools as YAML list."""
        skill_md = tmp_path / "SKILL.md"
        skill_md.write_text("""---
name: list-tools
description: Skill with list tools
allowed-tools:
  - read
  - write
  - bash
---

Instructions.
""")
        skill = SkillParser.parse(skill_md)

        assert skill is not None
        assert skill.allowed_tools == ["read", "write", "bash"]


class TestSkillParserSupportingFiles:
    """Tests for supporting file scanning."""

    def test_scan_supporting_files(self, tmp_path):
        """Test scanning supporting files."""
        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()

        # Create SKILL.md
        (skill_dir / "SKILL.md").write_text("---\nname: test\ndescription: test\n---\n")

        # Create supporting files
        (skill_dir / "example.py").write_text("# example")
        (skill_dir / "data.json").write_text("{}")

        subdir = skill_dir / "templates"
        subdir.mkdir()
        (subdir / "template.txt").write_text("template")

        files = SkillParser.scan_supporting_files(skill_dir)

        assert len(files) == 3
        assert "example.py" in files
        assert "data.json" in files
        assert "templates/template.txt" in files

    def test_scan_empty_directory(self, tmp_path):
        """Test scanning empty directory."""
        skill_dir = tmp_path / "empty-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("---\nname: test\ndescription: test\n---\n")

        files = SkillParser.scan_supporting_files(skill_dir)

        assert len(files) == 0

    def test_scan_nonexistent_directory(self, tmp_path):
        """Test scanning nonexistent directory."""
        files = SkillParser.scan_supporting_files(tmp_path / "nonexistent")

        assert len(files) == 0


class TestSkillValidation:
    """Tests for skill validation."""

    def test_validate_valid_skill(self):
        """Test validating a valid skill."""
        skill = SkillInfo(
            name="valid-skill",
            description="A valid skill with proper description",
            instructions="Do something useful",
        )
        warnings = SkillParser.validate(skill)

        assert len(warnings) == 0

    def test_validate_invalid_name(self):
        """Test validating skill with invalid name."""
        skill = SkillInfo(
            name="Invalid_Name",
            description="A skill with invalid name format",
            instructions="Instructions",
        )
        warnings = SkillParser.validate(skill)

        assert any("lowercase" in w for w in warnings)

    def test_validate_short_description(self):
        """Test validating skill with short description."""
        skill = SkillInfo(
            name="short-desc",
            description="Too short",
            instructions="Instructions",
        )
        warnings = SkillParser.validate(skill)

        assert any("too short" in w for w in warnings)

    def test_validate_empty_instructions(self):
        """Test validating skill with empty instructions."""
        skill = SkillInfo(
            name="no-instructions",
            description="A skill without any instructions",
            instructions="",
        )
        warnings = SkillParser.validate(skill)

        assert any("no instructions" in w for w in warnings)
