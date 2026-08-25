# Security Policy

## Supported versions

Report vulnerabilities against the latest `main` build of DeepSeek Harness Desktop.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository. Do not open a public issue for security reports.

Protected data includes:

- API keys, bearer tokens, and Authorization headers
- Environment variables
- User conversation bodies from Harness

The desktop shell never asks you to paste secrets. Harness itself manages model credentials inside its own UI.

## Local-only service

The wrapped `dsh web` process is bound to `127.0.0.1`. It is not intended for LAN or remote access.

## Optional code signing

Release workflows can use `CSC_LINK` and `CSC_KEY_PASSWORD` if you later add a Windows Authenticode certificate. Unsigned builds may show SmartScreen warnings.
