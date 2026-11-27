# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## 0.2.0 (unreleased)

### Added
- Demo data: `pnpm demo` seeds `~/.bousleh-demo` with a fictional cast, `pnpm demo:home` shows Home on it at http://localhost:4173, and `scripts/setup-mac.sh --demo` adds it to Claude as the `bousleh-demo` server (`--demo --remove` takes it out).
- First run: "Bousleh: set me up" in Capture files who you are, your first scopes with a line of strategy each, and a starter watch list per scope. Pulse suggests it when your data is empty.
- README, brand assets (`docs/assets/`: logos, social preview, screenshots and a GIF of Home) and THIRD_PARTY_NOTICES.md.

### Changed
- Home's fonts are self-hosted: inlined from the `@fontsource` packages, so opening Home pings nobody.
- Clone the repo anywhere: the `.nosync` name is now a tip for iCloud folders, not a step.

### Security
- TBD

## 0.1.0 (2026-11-27)

Private baseline. Tagged before the open-source work.
