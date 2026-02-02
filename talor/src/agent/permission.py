"""Permission System for Talor.

This module provides the permission system for controlling tool access.

Features:
- Permission rules with patterns
- Permission actions (allow, deny, ask)
- Permission merging
- Permission checking
"""

from __future__ import annotations

import fnmatch
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


logger = logging.getLogger(__name__)


class PermissionAction(str, Enum):
    """Permission action types."""
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"


class PermissionRule(BaseModel):
    """A single permission rule.

    Defines access control for a specific tool or pattern.

    Attributes:
        permission: Permission type (tool name or category)
        action: Action to take (allow, deny, ask)
        pattern: Pattern to match (glob-style)
    """

    permission: str
    action: PermissionAction
    pattern: str = "*"

    def matches(self, tool: str, path: str | None = None) -> bool:
        """Check if this rule matches the given tool and path.

        Args:
            tool: Tool name
            path: Optional path for file-based permissions

        Returns:
            True if rule matches
        """
        # Check permission match
        if self.permission != "*" and self.permission != tool:
            # Check if it's a category match
            if not fnmatch.fnmatch(tool, self.permission):
                return False

        # Check pattern match
        if path and self.pattern != "*":
            if not fnmatch.fnmatch(path, self.pattern):
                return False

        return True


# Type alias for ruleset
Ruleset = list[PermissionRule]


class Permission:
    """Permission management namespace.

    Provides methods for creating, merging, and checking permissions.
    """

    @staticmethod
    def from_config(config: dict[str, Any]) -> Ruleset:
        """Create ruleset from configuration dictionary.

        Args:
            config: Configuration dictionary like:
                {
                    "*": "allow",
                    "bash": "ask",
                    "read": {"*": "allow", "*.env": "ask"},
                }

        Returns:
            List of PermissionRule
        """
        rules: Ruleset = []

        for permission, value in config.items():
            if isinstance(value, str):
                # Simple action
                action = PermissionAction(value)
                rules.append(PermissionRule(
                    permission=permission,
                    action=action,
                    pattern="*",
                ))
            elif isinstance(value, dict):
                # Pattern-based rules
                for pattern, action_str in value.items():
                    action = PermissionAction(action_str)
                    rules.append(PermissionRule(
                        permission=permission,
                        action=action,
                        pattern=pattern,
                    ))

        return rules

    @staticmethod
    def merge(*rulesets: Ruleset) -> Ruleset:
        """Merge multiple rulesets.

        Later rulesets override earlier ones.

        Args:
            *rulesets: Rulesets to merge

        Returns:
            Merged ruleset
        """
        result: Ruleset = []

        for ruleset in rulesets:
            for rule in ruleset:
                # Remove conflicting rules
                result = [
                    r for r in result
                    if not (r.permission == rule.permission and r.pattern == rule.pattern)
                ]
                result.append(rule)

        return result

    @staticmethod
    def check(
        ruleset: Ruleset,
        tool: str,
        path: str | None = None,
    ) -> PermissionAction:
        """Check permission for a tool and path.

        Args:
            ruleset: Permission ruleset
            tool: Tool name
            path: Optional path for file-based permissions

        Returns:
            Permission action (allow, deny, ask)
        """
        # Find matching rules (most specific first)
        matching_rules = []

        for rule in ruleset:
            if rule.matches(tool, path):
                matching_rules.append(rule)

        if not matching_rules:
            # Default to ask if no rules match
            return PermissionAction.ASK

        # Sort by specificity (more specific patterns first)
        def specificity(rule: PermissionRule) -> int:
            score = 0
            if rule.permission != "*":
                score += 10
            if rule.pattern != "*":
                score += 5
            return score

        matching_rules.sort(key=specificity, reverse=True)

        return matching_rules[0].action

    @staticmethod
    def is_allowed(
        ruleset: Ruleset,
        tool: str,
        path: str | None = None,
    ) -> bool:
        """Check if action is allowed.

        Args:
            ruleset: Permission ruleset
            tool: Tool name
            path: Optional path

        Returns:
            True if allowed
        """
        action = Permission.check(ruleset, tool, path)
        return action == PermissionAction.ALLOW

    @staticmethod
    def needs_ask(
        ruleset: Ruleset,
        tool: str,
        path: str | None = None,
    ) -> bool:
        """Check if action needs user confirmation.

        Args:
            ruleset: Permission ruleset
            tool: Tool name
            path: Optional path

        Returns:
            True if needs ask
        """
        action = Permission.check(ruleset, tool, path)
        return action == PermissionAction.ASK
