"""Tests for SkillPreprocessor - $ARGUMENTS substitution and !`command` execution."""

import pytest
from src.skill.preprocessor import SkillPreprocessor


class TestArgumentsSubstitution:
    """Tests for $ARGUMENTS variable substitution."""

    def test_replace_arguments_simple(self):
        """$ARGUMENTS replaced with full arguments string."""
        result = SkillPreprocessor.process(
            "Fix issue $ARGUMENTS in the codebase",
            arguments="123",
        )
        assert result == "Fix issue 123 in the codebase"

    def test_replace_arguments_empty(self):
        """$ARGUMENTS replaced with empty string when no args."""
        result = SkillPreprocessor.process(
            "Run task $ARGUMENTS",
            arguments="",
        )
        assert result == "Run task "

    def test_replace_arguments_multiword(self):
        """$ARGUMENTS replaced with multi-word arguments."""
        result = SkillPreprocessor.process(
            "Process: $ARGUMENTS",
            arguments="hello world foo",
        )
        assert result == "Process: hello world foo"

    def test_no_arguments_placeholder(self):
        """Instructions without $ARGUMENTS left unchanged."""
        result = SkillPreprocessor.process(
            "Just do the task",
            arguments="ignored",
        )
        assert result == "Just do the task"


class TestPositionalArguments:
    """Tests for $N and $ARGUMENTS[N] positional substitution."""

    def test_positional_dollar_n(self):
        """$0, $1, $2 replaced with positional args."""
        result = SkillPreprocessor.process(
            "First: $0, Second: $1",
            arguments="alpha beta",
        )
        assert result == "First: alpha, Second: beta"

    def test_positional_arguments_bracket(self):
        """$ARGUMENTS[N] replaced with positional args."""
        result = SkillPreprocessor.process(
            "Repo: $ARGUMENTS[0], Branch: $ARGUMENTS[1]",
            arguments="my-repo main",
        )
        assert result == "Repo: my-repo, Branch: main"

    def test_positional_out_of_range(self):
        """Out-of-range positional args replaced with empty string."""
        result = SkillPreprocessor.process(
            "First: $0, Missing: $5",
            arguments="only-one",
        )
        assert result == "First: only-one, Missing: "

    def test_positional_quoted_args(self):
        """Quoted arguments treated as single token."""
        result = SkillPreprocessor.process(
            "Title: $0",
            arguments='"hello world"',
        )
        assert result == "Title: hello world"


class TestEnvVarSubstitution:
    """Tests for ${VAR_NAME} environment variable substitution."""

    def test_session_id_substitution(self):
        """${CLAUDE_SESSION_ID} replaced with session_id."""
        result = SkillPreprocessor.process(
            "Session: ${CLAUDE_SESSION_ID}",
            session_id="sess-abc123",
        )
        assert result == "Session: sess-abc123"

    def test_session_id_missing(self):
        """${CLAUDE_SESSION_ID} replaced with empty when no session_id."""
        result = SkillPreprocessor.process(
            "Session: ${CLAUDE_SESSION_ID}",
            session_id=None,
        )
        assert result == "Session: "

    def test_unknown_env_var_kept(self):
        """Unknown ${VAR} kept as-is if not in environment."""
        import os
        os.environ.pop("TALOR_TEST_UNKNOWN_VAR", None)
        result = SkillPreprocessor.process(
            "Value: ${TALOR_TEST_UNKNOWN_VAR}",
        )
        assert result == "Value: ${TALOR_TEST_UNKNOWN_VAR}"


class TestCommandExecution:
    """Tests for !`command` dynamic context injection."""

    def test_command_execution(self):
        """!`command` replaced with command output."""
        result = SkillPreprocessor.process(
            "Date: !`echo hello`",
            execute_commands=True,
        )
        assert result == "Date: hello"

    def test_command_disabled(self):
        """!`command` kept as-is when execute_commands=False."""
        result = SkillPreprocessor.process(
            "Date: !`date`",
            execute_commands=False,
        )
        assert result == "Date: !`date`"

    def test_command_error_handled(self):
        """Failed command returns error message, doesn't raise."""
        result = SkillPreprocessor.process(
            "Output: !`exit 1`",
            execute_commands=True,
        )
        # Should not raise, returns some output
        assert "Output:" in result

    @pytest.mark.asyncio
    async def test_async_command_execution(self):
        """Async version executes commands without blocking."""
        result = await SkillPreprocessor.process_async(
            "Echo: !`echo async-test`",
            execute_commands=True,
        )
        assert result == "Echo: async-test"

    @pytest.mark.asyncio
    async def test_async_multiple_commands(self):
        """Multiple commands executed concurrently."""
        result = await SkillPreprocessor.process_async(
            "A: !`echo one` B: !`echo two`",
            execute_commands=True,
        )
        assert "one" in result
        assert "two" in result


class TestArgumentSplitting:
    """Tests for argument string splitting."""

    def test_split_simple(self):
        args = SkillPreprocessor._split_arguments("a b c")
        assert args == ["a", "b", "c"]

    def test_split_quoted(self):
        args = SkillPreprocessor._split_arguments('"hello world" foo')
        assert args == ["hello world", "foo"]

    def test_split_empty(self):
        args = SkillPreprocessor._split_arguments("")
        assert args == []

    def test_split_single(self):
        args = SkillPreprocessor._split_arguments("single")
        assert args == ["single"]
