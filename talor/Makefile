.PHONY: help install install-dev test test-cov format lint typecheck clean build build-exe docker

help:
	@echo "Talor Development Commands"
	@echo ""
	@echo "Development:"
	@echo "  make install       Install package"
	@echo "  make install-dev   Install package with dev dependencies"
	@echo "  make test          Run tests"
	@echo "  make test-cov      Run tests with coverage report"
	@echo "  make format        Format code with black"
	@echo "  make lint          Lint code with ruff"
	@echo "  make typecheck     Type check with mypy"
	@echo ""
	@echo "Building:"
	@echo "  make build         Build Python package (sdist and wheel)"
	@echo "  make build-exe     Build standalone executable with PyInstaller"
	@echo "  make docker        Build Docker image"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean         Clean build artifacts"
	@echo ""

# =============================================================================
# Development
# =============================================================================

install:
	pip install -e .

install-dev:
	pip install -e ".[dev]"

install-all:
	pip install -e ".[all]"

test:
	pytest -v

test-cov:
	pytest --cov=talor --cov-report=html --cov-report=term

format:
	black talor tests

lint:
	ruff check talor tests

typecheck:
	mypy talor

check: format lint typecheck
	@echo "All checks passed!"

# =============================================================================
# Building
# =============================================================================

build:
	pip install build
	python -m build

build-exe:
	pip install pyinstaller
	pyinstaller talor.spec

docker:
	docker build -t talor:latest .

docker-run:
	docker run -it --rm \
		-v $(PWD):/workspace \
		-v ~/.config/talor:/home/talor/.config/talor \
		talor:latest --help

# =============================================================================
# Publishing
# =============================================================================

publish-test:
	pip install twine
	twine upload --repository testpypi dist/*

publish:
	pip install twine
	twine upload dist/*

# =============================================================================
# Cleanup
# =============================================================================

clean:
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info
	rm -rf .pytest_cache
	rm -rf .coverage
	rm -rf htmlcov
	rm -rf .mypy_cache
	rm -rf .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
