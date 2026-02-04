"""LLM Plugin for Talor.

This plugin provides LLM-specific configurations and prompt optimizations.

Features:
- Model detection
- Model-specific configurations
- Model-specific prompt templates for optimal performance
- Token limit adjustments

Updated: February 2026 with latest model specifications.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from src.plugin.base import PromptPlugin, PluginPriority
from src.plugin.context import PluginContext
from src.plugin.result import PluginResult

logger = logging.getLogger(__name__)


class LLMPlugin(PromptPlugin):
    """LLM Plugin - Model-specific configurations and prompt optimizations.

    Responsibilities:
    - Detect current LLM model
    - Load model-specific configurations
    - Inject model-specific prompt guidance for optimal performance
    - Adjust context window based on model limits
    """

    # Model-specific configurations (Updated February 2026)
    MODEL_CONFIGS: dict[str, dict[str, dict[str, Any]]] = {
        "anthropic": {
            # Claude 4 Series (Latest)
            "claude-opus-4.5": {
                "max_tokens": 200000,
                "output_tokens": 32000,
                "supports_tools": True,
                "supports_vision": True,
                "family": "claude4",
            },
            "claude-sonnet-4": {
                "max_tokens": 200000,
                "output_tokens": 16000,
                "supports_tools": True,
                "supports_vision": True,
                "family": "claude4",
            },
            # Claude 3.5 Series
            "claude-3.5-sonnet": {
                "max_tokens": 200000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "claude35",
            },
            "claude-3.5-haiku": {
                "max_tokens": 200000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "claude35",
            },
            # Claude 3 Series (Legacy)
            "claude-3-opus": {
                "max_tokens": 200000,
                "output_tokens": 4096,
                "supports_tools": True,
                "supports_vision": True,
                "family": "claude3",
            },
            "claude-3-sonnet": {
                "max_tokens": 200000,
                "output_tokens": 4096,
                "supports_tools": True,
                "supports_vision": True,
                "family": "claude3",
            },
            "claude-3-haiku": {
                "max_tokens": 200000,
                "output_tokens": 4096,
                "supports_tools": True,
                "supports_vision": True,
                "family": "claude3",
            },
        },
        "openai": {
            # GPT-5 Series (Latest)
            "gpt-5.2": {
                "max_tokens": 400000,
                "output_tokens": 32000,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gpt5",
            },
            "gpt-5.2-mini": {
                "max_tokens": 200000,
                "output_tokens": 16000,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gpt5",
            },
            # GPT-4 Series
            "gpt-4o": {
                "max_tokens": 128000,
                "output_tokens": 16384,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gpt4o",
            },
            "gpt-4o-mini": {
                "max_tokens": 128000,
                "output_tokens": 16384,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gpt4o",
            },
            "gpt-4-turbo": {
                "max_tokens": 128000,
                "output_tokens": 4096,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gpt4",
            },
            "gpt-4": {
                "max_tokens": 8192,
                "output_tokens": 4096,
                "supports_tools": True,
                "supports_vision": False,
                "family": "gpt4",
            },
            # o-Series Reasoning Models
            "o3": {
                "max_tokens": 200000,
                "output_tokens": 100000,
                "supports_tools": True,
                "supports_vision": True,
                "family": "o3",
            },
            "o3-mini": {
                "max_tokens": 200000,
                "output_tokens": 65536,
                "supports_tools": True,
                "supports_vision": False,
                "family": "o3",
            },
            "o1": {
                "max_tokens": 200000,
                "output_tokens": 100000,
                "supports_tools": False,
                "supports_vision": True,
                "family": "o1",
            },
            "o1-mini": {
                "max_tokens": 128000,
                "output_tokens": 65536,
                "supports_tools": False,
                "supports_vision": False,
                "family": "o1",
            },
            "o1-pro": {
                "max_tokens": 200000,
                "output_tokens": 100000,
                "supports_tools": False,
                "supports_vision": True,
                "family": "o1",
            },
        },
        "google": {
            # Gemini 3 Series (Latest)
            "gemini-3-pro": {
                "max_tokens": 1000000,
                "output_tokens": 65536,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gemini3",
            },
            "gemini-3-flash": {
                "max_tokens": 1000000,
                "output_tokens": 32768,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gemini3",
            },
            # Gemini 2 Series
            "gemini-2.0-flash": {
                "max_tokens": 1000000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gemini2",
            },
            "gemini-2.0-flash-thinking": {
                "max_tokens": 1000000,
                "output_tokens": 65536,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gemini2-thinking",
            },
            # Gemini 1.5 Series
            "gemini-1.5-pro": {
                "max_tokens": 2000000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gemini15",
            },
            "gemini-1.5-flash": {
                "max_tokens": 1000000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "gemini15",
            },
        },
        "deepseek": {
            # DeepSeek V3 Series (Latest)
            "deepseek-v3.2": {
                "max_tokens": 128000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "deepseek-v3",
            },
            "deepseek-chat": {
                "max_tokens": 64000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "deepseek-v3",
            },
            "deepseek-coder": {
                "max_tokens": 64000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "deepseek-v3",
            },
            # DeepSeek R1 Reasoning
            "deepseek-r1": {
                "max_tokens": 64000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "deepseek-r1",
            },
            "deepseek-reasoner": {
                "max_tokens": 64000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "deepseek-r1",
            },
        },
        "meta": {
            # Llama 4 Series (Latest)
            "llama-4": {
                "max_tokens": 128000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "llama4",
            },
            "llama-4-maverick": {
                "max_tokens": 1000000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "llama4",
            },
            # Llama 3 Series
            "llama-3.3": {
                "max_tokens": 128000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "llama3",
            },
            "llama-3.2": {
                "max_tokens": 128000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "llama3",
            },
        },
        "mistral": {
            # Mistral Large (Latest)
            "mistral-large": {
                "max_tokens": 128000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "mistral",
            },
            "mistral-medium": {
                "max_tokens": 32000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "mistral",
            },
            "mistral-small": {
                "max_tokens": 32000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "mistral",
            },
            "codestral": {
                "max_tokens": 32000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "mistral-code",
            },
        },
        "xai": {
            # Grok Series
            "grok-3": {
                "max_tokens": 131072,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "grok",
            },
            "grok-2": {
                "max_tokens": 131072,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "grok",
            },
        },
        "alibaba": {
            # Qwen Series
            "qwen-max": {
                "max_tokens": 128000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "qwen",
            },
            "qwen-plus": {
                "max_tokens": 128000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": True,
                "family": "qwen",
            },
            "qwen-turbo": {
                "max_tokens": 128000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "qwen",
            },
            "qwen-coder": {
                "max_tokens": 128000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "qwen-code",
            },
        },
        # Ollama local models (prefix matching)
        "ollama": {
            "llama": {
                "max_tokens": 128000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "llama3",
            },
            "qwen": {
                "max_tokens": 32000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "qwen",
            },
            "deepseek": {
                "max_tokens": 64000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "deepseek-v3",
            },
            "mistral": {
                "max_tokens": 32000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "mistral",
            },
            "codestral": {
                "max_tokens": 32000,
                "output_tokens": 8192,
                "supports_tools": True,
                "supports_vision": False,
                "family": "mistral-code",
            },
        },
    }

    # Model family-specific prompt guidance
    MODEL_PROMPTS: dict[str, str] = {
        "claude4": """## Model: Claude Opus 4.5 / Sonnet 4
You are running on Claude 4, Anthropic's most capable model family.

Strengths:
- Best-in-class code generation (80.9% SWE-bench)
- Excellent instruction following and safety
- Strong reasoning with extended thinking
- Superior context retention in long conversations

Best Practices:
- Use <thinking> tags for complex multi-step reasoning
- Structure outputs with clear sections and headers
- Leverage strong tool-use capabilities
- Take advantage of large output token limits
""",
        "claude35": """## Model: Claude 3.5 Series
You are running on Claude 3.5, optimized for speed and capability balance.

Strengths:
- Fast inference with strong capabilities
- Excellent code understanding
- Good multimodal processing
- Reliable instruction following

Best Practices:
- Be explicit about output format requirements
- Use structured prompts for complex tasks
- Leverage vision capabilities when relevant
""",
        "claude3": """## Model: Claude 3 Series
You are running on Claude 3, a capable general-purpose model.

Strengths:
- Solid reasoning capabilities
- Good instruction following
- Multimodal support

Best Practices:
- Keep prompts clear and well-structured
- Break complex tasks into steps
""",
        "gpt5": """## Model: GPT-5.2
You are running on GPT-5.2, OpenAI's latest flagship model.

Strengths:
- Fastest inference (187 tokens/second)
- 400K context window
- Strong general reasoning
- Excellent for real-time interactions

Best Practices:
- Leverage speed for interactive workflows
- Use for user-facing applications requiring quick responses
- Take advantage of large context for comprehensive analysis
""",
        "gpt4o": """## Model: GPT-4o
You are running on GPT-4o, optimized for multimodal tasks.

Strengths:
- Strong multimodal capabilities
- Fast inference
- Good tool use
- Balanced cost/performance

Best Practices:
- Leverage vision capabilities for image analysis
- Use for interactive applications
- Good default choice for general tasks
""",
        "gpt4": """## Model: GPT-4 / GPT-4 Turbo
You are running on GPT-4, a proven capable model.

Strengths:
- Reliable reasoning
- Strong instruction following
- Well-documented behavior

Best Practices:
- Use explicit formatting instructions
- Break complex tasks into clear steps
""",
        "o3": """## Model: o3 / o3-mini
You are running on o3, OpenAI's advanced reasoning model.

Strengths:
- State-of-the-art reasoning (54.2% ARC-AGI-2)
- Perfect AIME 2025 score (100%)
- Deep logical analysis
- Tool use supported

Best Practices:
- Present problems that benefit from deep reasoning
- Allow extended thinking time
- Use for complex analytical tasks
- Leverage tool calling for verification
""",
        "o1": """## Model: o1 / o1-mini / o1-pro
You are running on o1, a reasoning-focused model.

Strengths:
- Strong logical reasoning
- Mathematical problem solving
- Extended thinking capabilities

Limitations:
- Tool calling NOT supported
- Plan actions verbally instead

Best Practices:
- Present complete problem context
- Allow space for extended reasoning
- Focus on accuracy over speed
""",
        "gemini3": """## Model: Gemini 3 Pro / Flash
You are running on Gemini 3, Google's latest multimodal model.

Strengths:
- Massive 1M token context window
- Excellent multimodal processing (images, audio, video)
- Strong reasoning with Deep Think mode
- Good for analyzing entire repositories

Best Practices:
- Leverage huge context for comprehensive analysis
- Use for multimodal workflows
- Take advantage of native Google integrations
""",
        "gemini2": """## Model: Gemini 2.0 Flash
You are running on Gemini 2.0, optimized for speed.

Strengths:
- Fast inference
- Good multimodal support
- Large context window

Best Practices:
- Use for quick multimodal tasks
- Leverage speed for interactive applications
""",
        "gemini2-thinking": """## Model: Gemini 2.0 Flash Thinking
You are running on Gemini 2.0 with extended thinking.

Strengths:
- Enhanced reasoning capabilities
- Large output token limit
- Multimodal support

Best Practices:
- Use for complex reasoning tasks
- Allow extended thinking time
""",
        "gemini15": """## Model: Gemini 1.5 Pro / Flash
You are running on Gemini 1.5 with massive context.

Strengths:
- Up to 2M token context (Pro)
- Good multimodal support
- Reliable performance

Best Practices:
- Use for long-document analysis
- Leverage large context for comprehensive tasks
""",
        "deepseek-v3": """## Model: DeepSeek V3.2 / Chat / Coder
You are running on DeepSeek V3, excellent value for performance.

Strengths:
- 94% cost savings vs premium models
- Strong code capabilities
- Good reasoning
- Open weights available

Best Practices:
- Excellent for high-volume processing
- Use for cost-sensitive applications
- Good for code-related tasks
""",
        "deepseek-r1": """## Model: DeepSeek R1 / Reasoner
You are running on DeepSeek R1, a reasoning-focused model.

Strengths:
- Transparent chain-of-thought reasoning
- Strong mathematical capabilities
- Cost-effective reasoning

Best Practices:
- Use for tasks requiring explicit reasoning steps
- Good for mathematical and analytical problems
- Leverage transparent thinking process
""",
        "llama4": """## Model: Llama 4 / Maverick
You are running on Llama 4, Meta's latest open model.

Strengths:
- Near frontier-level performance
- Open weights for self-hosting
- Up to 1M context (Maverick)
- Multimodal support

Best Practices:
- Good for privacy-sensitive deployments
- Use for self-hosted applications
- Leverage open nature for customization
""",
        "llama3": """## Model: Llama 3.x Series
You are running on Llama 3, a capable open model.

Strengths:
- Strong general capabilities
- Open weights
- Good instruction following

Best Practices:
- Good for local/self-hosted deployments
- Use clear, structured prompts
""",
        "mistral": """## Model: Mistral Large / Medium / Small
You are running on Mistral, efficient European AI.

Strengths:
- Efficient inference
- Good multilingual support
- Strong for European deployments

Best Practices:
- Use for efficiency-focused applications
- Good for multilingual tasks
""",
        "mistral-code": """## Model: Codestral
You are running on Codestral, Mistral's code-specialized model.

Strengths:
- Optimized for code generation
- Fast inference
- Good for development workflows

Best Practices:
- Use for code-focused tasks
- Leverage speed for interactive coding
""",
        "grok": """## Model: Grok 3 / Grok 2
You are running on Grok, xAI's conversational model.

Strengths:
- Real-time data access (via X)
- Conversational capabilities
- Multimodal support

Best Practices:
- Use for tasks benefiting from current information
- Good for conversational applications
""",
        "qwen": """## Model: Qwen Max / Plus / Turbo
You are running on Qwen, Alibaba's multilingual model.

Strengths:
- Excellent multilingual support (especially Chinese)
- Strong reasoning
- Good code capabilities

Best Practices:
- Excellent for multilingual applications
- Use for Chinese language tasks
- Good general-purpose choice
""",
        "qwen-code": """## Model: Qwen Coder
You are running on Qwen Coder, optimized for development.

Strengths:
- Code-focused capabilities
- Multilingual code understanding
- Good for development workflows

Best Practices:
- Use for code generation and analysis
- Leverage multilingual code support
""",
    }

    # Default configuration
    DEFAULT_CONFIG: dict[str, Any] = {
        "max_tokens": 8192,
        "output_tokens": 4096,
        "supports_tools": True,
        "supports_vision": False,
        "family": "default",
    }

    DEFAULT_PROMPT = """## Model: Unknown
Using default model configuration.

Best Practices:
- Keep instructions clear and specific
- Use structured output formats
- Break complex tasks into steps
- Verify tool availability before planning
"""

    def __init__(self) -> None:
        """Initialize the LLM plugin."""
        super().__init__(
            name="llm",
            priority=PluginPriority.LLM,
            enabled=True,
            required=True,
        )
        self._prompt_cache: dict[str, str] = {}  # Cache for loaded prompts

    async def build(self, context: PluginContext) -> PluginResult | None:
        """Build LLM-specific configuration and prompt guidance.

        Args:
            context: Plugin execution context

        Returns:
            PluginResult with LLM-specific prompt and configuration
        """
        provider = context.provider_id
        model = context.model_id

        config = self._get_model_config(provider, model)
        family = config.get("family", "default")

        # Get model-specific prompt guidance (from file or fallback)
        prompt = await self._load_model_prompt(family)

        return PluginResult(
            content=f"<model_guidance>\n{prompt}\n</model_guidance>",
            section="llm",
            metadata={"model_config": config, "model_family": family},
        )

    def _infer_family_from_model(self, provider: str, model: str) -> str:
        """Infer model family from provider and model name using rules.

        Args:
            provider: Provider ID (e.g., "anthropic", "openai")
            model: Model ID (e.g., "claude-opus-4.5", "gpt-5.2")

        Returns:
            Inferred family name
        """
        model_lower = model.lower()

        # Anthropic Claude rules
        if provider == "anthropic":
            if "claude-4" in model_lower or "claude-opus-4" in model_lower or "claude-sonnet-4" in model_lower or "claude-haiku-4" in model_lower:
                return "claude4"
            elif "claude-3.5" in model_lower or "claude-3-5" in model_lower:
                return "claude35"
            elif "claude-3" in model_lower:
                return "claude3"

        # OpenAI rules
        elif provider == "openai":
            # GPT-5 series
            if model_lower.startswith("gpt-5"):
                return "gpt5"
            # GPT-4o series
            elif "gpt-4o" in model_lower:
                return "gpt4o"
            # GPT-4 series
            elif model_lower.startswith("gpt-4"):
                return "gpt4"
            # o3 reasoning series
            elif model_lower.startswith("o3") or model_lower.startswith("o4"):
                return "o3"
            # o1 reasoning series
            elif model_lower.startswith("o1"):
                return "o1"

        # Google Gemini rules
        elif provider == "google":
            if "gemini-3" in model_lower or "gemini-3.0" in model_lower:
                return "gemini3"
            elif "gemini-2.0" in model_lower and "thinking" in model_lower:
                return "gemini2-thinking"
            elif "gemini-2" in model_lower or "gemini-2.0" in model_lower:
                return "gemini2"
            elif "gemini-1.5" in model_lower:
                return "gemini15"

        # DeepSeek rules
        elif provider == "deepseek":
            if "r1" in model_lower or "reasoner" in model_lower:
                return "deepseek-r1"
            elif "v3" in model_lower or "chat" in model_lower or "coder" in model_lower:
                return "deepseek-v3"

        # Meta Llama rules
        elif provider == "meta":
            if "llama-4" in model_lower or "llama4" in model_lower:
                return "llama4"
            elif "llama-3" in model_lower or "llama3" in model_lower:
                return "llama3"

        # Mistral rules
        elif provider == "mistral":
            if "codestral" in model_lower:
                return "mistral-code"
            else:
                return "mistral"

        # Alibaba Qwen rules
        elif provider == "alibaba":
            if "coder" in model_lower:
                return "qwen-code"
            else:
                return "qwen"

        # xAI Grok rules
        elif provider == "xai":
            return "grok"

        # Ollama local models - prefix matching
        elif provider == "ollama":
            if model_lower.startswith("llama"):
                return "llama3"
            elif model_lower.startswith("qwen"):
                return "qwen"
            elif model_lower.startswith("deepseek"):
                return "deepseek-v3"
            elif model_lower.startswith("mistral"):
                return "mistral"
            elif model_lower.startswith("codestral"):
                return "mistral-code"

        # Default fallback
        return "default"

    async def _load_model_prompt(self, family: str) -> str:
        """Load model prompt from file with caching.

        Args:
            family: Model family identifier (e.g., "claude4", "gpt5")

        Returns:
            Model prompt content
        """
        # Check cache first
        if family in self._prompt_cache:
            return self._prompt_cache[family]

        # Try to load from file
        prompt_file = Path(__file__).parent.parent.parent.parent / "prompts" / "llm" / f"{family}.md"

        try:
            if prompt_file.exists():
                content = prompt_file.read_text(encoding="utf-8").strip()
                self._prompt_cache[family] = content
                logger.debug(f"Loaded LLM prompt for family '{family}' from {prompt_file}")
                return content
        except Exception as e:
            logger.warning(f"Failed to load LLM prompt from {prompt_file}: {e}")

        # Fallback to hardcoded prompt
        fallback = self.MODEL_PROMPTS.get(family, self.DEFAULT_PROMPT)
        self._prompt_cache[family] = fallback
        logger.debug(f"Using fallback LLM prompt for family '{family}'")
        return fallback

    def _get_model_config(
        self,
        provider: str,
        model: str,
    ) -> dict[str, Any]:
        """Get configuration for a specific model.

        Uses rule-based inference to determine model family and configuration.

        Args:
            provider: Provider ID (e.g., "anthropic", "openai")
            model: Model ID (e.g., "claude-opus-4.5", "gpt-5.2")

        Returns:
            Model configuration dictionary
        """
        # Try exact match first in MODEL_CONFIGS
        provider_configs = self.MODEL_CONFIGS.get(provider, {})
        if model in provider_configs:
            return provider_configs[model]

        # Try prefix match in MODEL_CONFIGS
        for model_prefix, config in provider_configs.items():
            if model.startswith(model_prefix):
                return config

        # Infer family from rules and create default config
        family = self._infer_family_from_model(provider, model)
        config = self.DEFAULT_CONFIG.copy()
        config["family"] = family

        logger.debug(f"Inferred family '{family}' for {provider}/{model}")
        return config

    def get_max_tokens(self, provider: str, model: str) -> int:
        """Get maximum input tokens for a model.

        Args:
            provider: Provider ID
            model: Model ID

        Returns:
            Maximum input token count
        """
        config = self._get_model_config(provider, model)
        return config.get("max_tokens", self.DEFAULT_CONFIG["max_tokens"])

    def get_output_tokens(self, provider: str, model: str) -> int:
        """Get maximum output tokens for a model.

        Args:
            provider: Provider ID
            model: Model ID

        Returns:
            Maximum output token count
        """
        config = self._get_model_config(provider, model)
        return config.get("output_tokens", self.DEFAULT_CONFIG["output_tokens"])

    def supports_tools(self, provider: str, model: str) -> bool:
        """Check if a model supports tools.

        Args:
            provider: Provider ID
            model: Model ID

        Returns:
            True if model supports tools
        """
        config = self._get_model_config(provider, model)
        return config.get("supports_tools", True)

    def supports_vision(self, provider: str, model: str) -> bool:
        """Check if a model supports vision.

        Args:
            provider: Provider ID
            model: Model ID

        Returns:
            True if model supports vision
        """
        config = self._get_model_config(provider, model)
        return config.get("supports_vision", False)

    def get_model_family(self, provider: str, model: str) -> str:
        """Get the model family for a specific model.

        Args:
            provider: Provider ID
            model: Model ID

        Returns:
            Model family identifier
        """
        config = self._get_model_config(provider, model)
        return config.get("family", "default")
