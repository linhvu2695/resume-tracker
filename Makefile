.PHONY: run test import

# Serve the tracker on http://127.0.0.1:8082/ (setup: README.md).
# 8082, not 8081 -- interview-prep uses 8081 and the two can run side by side.
# This app holds personal data (resumes, PII). It binds 127.0.0.1 and there is no
# BIND override on purpose. See README -> Privacy.
PORT ?= 8082
run:
	PYTHONUNBUFFERED=1 uv run server.py $(PORT)

# Import a job posting into applications/ from a URL:  make import URL='https://...'
import:
	@test -n "$(URL)" || { echo "usage: make import URL='https://www.vietnamworks.com/...-jv'"; exit 2; }
	uv run python -m lib.vietnamworks "$(URL)"

test:
	uv run --group dev pytest
