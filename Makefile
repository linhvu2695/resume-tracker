.PHONY: run test import demo demo-serve

# Serve the tracker on http://127.0.0.1:8082/ (setup: README.md).
# 8082, not 8081 -- interview-prep uses 8081 and the two can run side by side.
# This app holds personal data (resumes, PII). It binds 127.0.0.1 and there is no
# BIND override on purpose. See README -> Privacy.
PORT ?= 8082
run:
	PYTHONUNBUFFERED=1 uv run server.py $(PORT)

# Print what a job link imports (VietnamWorks, TopCV, any schema.org JobPosting):  make import URL='https://...'
import:
	@test -n "$(URL)" || { echo "usage: make import URL='<a VietnamWorks or TopCV job link>'"; exit 2; }
	uv run python -m lib.importer "$(URL)"

# Live demo (static site for Vercel): README -> Live demo.
demo:
	uv run python demo/build.py
demo-serve:
	uv run python demo/build.py --serve

test:
	uv run --group dev pytest
