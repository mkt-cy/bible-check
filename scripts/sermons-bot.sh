#!/bin/bash
# 맥에서 설교 목록 갱신 — launchd가 20분마다 부른다 (~/Library/LaunchAgents/com.mkt-cy.bible-check-sermons.plist)
# GitHub 예약 실행이 몇 시간씩 늦거나 빠져서(26.11.01.) 맥이 주 담당, Actions는 예비.
# 작업 폴더와 따로 둔 복제본(~/bible-check-bot)에서 돈다: ~/Documents는 macOS 권한(TCC)에 막히고, 작업 중인 변경과 섞이지 않게.
# 새 설교가 없으면 유튜브 목록 두 개만 받고 끝 (몇 초).
set -euo pipefail
cd "$(dirname "$0")/.."
git pull -q --rebase
node scripts/fetch-sermons.mjs --check | grep -q '^새 설교' || exit 0
node scripts/fetch-sermons.mjs
git diff --quiet data/sermons.json && exit 0
git commit -qm '설교 목록 갱신 (맥)' data/sermons.json
git pull -q --rebase
git push -q
