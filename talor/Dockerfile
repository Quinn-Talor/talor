# Talor Docker Image
# Multi-stage build for optimized image size

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM python:3.11-slim as builder

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy requirements and install dependencies
WORKDIR /build
COPY pyproject.toml README.md ./
COPY talor/ ./talor/

# Install the package
RUN pip install --upgrade pip && \
    pip install .

# =============================================================================
# Stage 2: Runtime
# =============================================================================
FROM python:3.11-slim as runtime

# Labels
LABEL org.opencontainers.image.title="Talor" \
      org.opencontainers.image.description="AI-powered coding assistant" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.vendor="Talor Team" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/talor-dev/talor"

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Talor configuration
    TALOR_LOG_LEVEL=INFO \
    # User configuration
    HOME=/home/talor

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user
RUN groupadd --gid 1000 talor && \
    useradd --uid 1000 --gid talor --shell /bin/bash --create-home talor

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Create directories for configuration and data
RUN mkdir -p /home/talor/.config/talor \
             /home/talor/.local/share/talor \
             /workspace && \
    chown -R talor:talor /home/talor /workspace

# Switch to non-root user
USER talor
WORKDIR /workspace

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD talor --version || exit 1

# Default command
ENTRYPOINT ["talor"]
CMD ["--help"]

# =============================================================================
# Usage Examples:
# =============================================================================
# Build the image:
#   docker build -t talor:latest .
#
# Run a prompt:
#   docker run -it --rm \
#     -v $(pwd):/workspace \
#     -v ~/.config/talor:/home/talor/.config/talor \
#     -e OPENAI_API_KEY=$OPENAI_API_KEY \
#     talor:latest run "Hello, what can you do?"
#
# Interactive shell:
#   docker run -it --rm \
#     -v $(pwd):/workspace \
#     -v ~/.config/talor:/home/talor/.config/talor \
#     --entrypoint /bin/bash \
#     talor:latest
#
# Start server:
#   docker run -d --rm \
#     -p 8080:8080 \
#     -v $(pwd):/workspace \
#     -v ~/.config/talor:/home/talor/.config/talor \
#     talor:latest serve --host 0.0.0.0 --port 8080
