"""Tests for SkillLoader."""

import pytest
from pathlib import Path

from src.skill.loader import SkillLoader


class TestSkillLoader:
    """Tests for SkillLoader."""

    @pytest.fixture
    def skill_dirs(self, tmp_path):
        """Create test skill directories."""
        # Create project skills directory
        project_skills = tmp_path / ".talor" / "skills"
        project_skills.mkdir(parents=True)

        # Create a project skill
        skill1_dir = project_skills / "project-skill"
        skill1_dir.mkdir()
        (skill1_dir / "SKILL.md").write_text("""---
name: project-skill
description: A project-level skill for testing
---

Project skill instructions.
""")

        return tmp_path

    @pytest.mark.asyncio
    async def test_initialize(self, skill_dirs):
        """Test loader initialization."""
        loader = SkillLoader(skill_dirs)
        await loader.initialize()

        assert loader.initialized is True
        assert loader.skill_count >= 1

    @pytest.mark.asyncio
    async def test_get_all_skills(self, skill_dirs):
        """Test getting all skills."""
        loader = SkillLoader(skill_dirs)
        await loader.initialize()

        skills = await loader.get_all_skills()

        assert len(skills) >= 1
        assert any(s.name == "project-skill" for s in skills)

    @pytest.mark.asyncio
    async def test_get_skill_by_name(self, skill_dirs):
        """Test getting skill by name."""
        loader = SkillLoader(skill_dirs)
        await loader.initialize()

        skill = await loader.get_skill("project-skill")

        assert skill is not None
        assert skill.name == "project-skill"
        assert skill.source_type == "project"

    @pytest.mark.asyncio
    async def test_get_nonexistent_skill(self, skill_dirs):
        """Test getting nonexistent skill."""
        loader = SkillLoader(skill_dirs)
        await loader.initialize()

        skill = await loader.get_skill("nonexistent")

        assert skill is None

    @pytest.mark.asyncio
    async def test_list_skills(self, skill_dirs):
        """Test listing skills."""
        loader = SkillLoader(skill_dirs)
        await loader.initialize()

        skills = await loader.list_skills()

        assert len(skills) >= 1
        assert any(s["name"] == "project-skill" for s in skills)

    @pytest.mark.asyncio
    async def test_reload(self, skill_dirs):
        """Test reloading skills."""
        loader = SkillLoader(skill_dirs)
        await loader.initialize()

        initial_count = loader.skill_count

        # Add a new skill
        new_skill_dir = skill_dirs / ".talor" / "skills" / "new-skill"
        new_skill_dir.mkdir()
        (new_skill_dir / "SKILL.md").write_text("""---
name: new-skill
description: A newly added skill for testing
---

New skill instructions.
""")

        await loader.reload()

        assert loader.skill_count == initial_count + 1


class TestSkillPriorityOverride:
    """Tests for skill priority override."""

    @pytest.fixture
    def override_dirs(self, tmp_path, monkeypatch):
        """Create directories with overlapping skills."""
        # Create personal skills directory
        personal_dir = tmp_path / "personal" / ".talor" / "skills"
        personal_dir.mkdir(parents=True)

        # Create project skills directory
        project_dir = tmp_path / "project" / ".talor" / "skills"
        project_dir.mkdir(parents=True)

        # Create same skill in both directories
        personal_skill = personal_dir / "shared-skill"
        personal_skill.mkdir()
        (personal_skill / "SKILL.md").write_text("""---
name: shared-skill
description: Personal version of shared skill
---

Personal instructions.
""")

        project_skill = project_dir / "shared-skill"
        project_skill.mkdir()
        (project_skill / "SKILL.md").write_text("""---
name: shared-skill
description: Project version of shared skill
---

Project instructions.
""")

        # Patch PERSONAL_DIR
        monkeypatch.setattr(SkillLoader, "PERSONAL_DIR", personal_dir.parent.parent / ".talor" / "skills")

        return tmp_path / "project"

    @pytest.mark.asyncio
    async def test_project_overrides_personal(self, override_dirs, monkeypatch):
        """Test that project skills override personal skills."""
        # Set up personal dir
        personal_base = override_dirs.parent / "personal"
        monkeypatch.setattr(SkillLoader, "PERSONAL_DIR", personal_base / ".talor" / "skills")

        loader = SkillLoader(override_dirs)
        await loader.initialize()

        skill = await loader.get_skill("shared-skill")

        assert skill is not None
        assert skill.source_type == "project"
        assert "Project instructions" in skill.instructions
