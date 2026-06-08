# Ergonomics / AI Commerce Agent

AI-assisted e-commerce interaction prototype for an ergonomics class project.
The repository contains a Chrome Extension side panel, lightweight API handlers,
and questionnaire analysis scripts.

## Overview

This project explores how an AI assistant can support online shopping tasks.
The prototype focuses on JD.com product search pages and provides:

- a Chrome Extension side panel UI
- content scripts that extract visible product information from search pages
- server/API handlers for language detection, query generation, speech-to-text,
  image-to-query conversion, and product search
- Python scripts for summarizing questionnaire results

## Repository Layout

```text
api/                         Serverless API handlers
ai-commerce-agent/extension/ Chrome Extension source
ai-commerce-agent/server/    Local Express server for development
ai-commerce-agent/analysis/  Analysis scripts only
room/                        Room-layout helper files
```

Raw questionnaire files, generated reports, browser profiles, local
environment files, and dependency directories are intentionally excluded from
the public source tree.

## Environment Variables

Do not commit real API keys. Copy `.env.example` or
`ai-commerce-agent/server/.env.example` and fill values locally.

```bash
OPENAI_API_KEY=
OPENAI_API_BASE=https://api.openai.com
OPENAI_MODEL=gpt-4.1-mini
OPENAI_VISION_MODEL=gpt-4o-mini
SERPAPI_KEY=
JD_APP_KEY=
JD_APP_SECRET=
PORT=3000
```

The code reads secrets from environment variables only. Missing keys should
fall back to limited or mock behavior depending on the endpoint.

## Local Development

Install root dependencies:

```bash
npm install
```

Install local server dependencies:

```bash
cd ai-commerce-agent/server
npm install
cp .env.example .env
npm start
```

Load the extension from `ai-commerce-agent/extension/` in Chrome's extension
developer mode.

## Analysis

The `ai-commerce-agent/analysis/` directory keeps reusable Python scripts and
dependency metadata. It should not contain raw participant data or generated
reports in Git.

Install analysis dependencies from:

```bash
pip install -r ai-commerce-agent/analysis/requirements.txt
```

Place local questionnaire files in `ai-commerce-agent/analysis/` only for local
work. They are ignored by Git.

## Public Safety Notes

Before making this repository public, verify that both the current tree and Git
history do not contain:

- `.env` files or API keys
- browser profiles such as `.pw-*`
- `node_modules/` directories
- raw questionnaire data, exported reports, or participant-level records
- local proxy/debug scripts

Current `.gitignore` rules prevent new copies of these files from being added,
but previously committed sensitive files must be removed from Git history before
changing repository visibility to public.

## Related Links

- Repository: https://github.com/Mr-Sakasu/Ergonomics
- Portfolio: https://github.com/Mr-Sakasu/portfolio
