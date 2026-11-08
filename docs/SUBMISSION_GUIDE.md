# Glassbox Lab 제출 가이드 (퀘스트 #19181)

## 0. 준비물 (이미 끝난 것)
- `glassbox-lab/` 폴더 = 완성된 앱 (빌드 불필요, 정적 파일)
- 단위 테스트 `node --test tests/*.test.js`, 브라우저 테스트 `tests/browser/smoke.mjs` 통과
- 오프라인 데모 `?demo=1`, 갤러리 4개, 오프라인 HTML 내보내기 동작 확인 완료

## 1. 사용자가 직접 해야 하는 것 (Claude는 권한이 없음)
1. **GitHub 저장소 만들기**: https://github.com/new → 이름 `glassbox-lab`, Public, 빈 저장소.
2. **코드 올리기**: zip을 풀어서 폴더 안의 내용을 저장소 루트에 업로드 (웹에서 "Add file → Upload files"로 드래그해도 됨). `.nojekyll` 파일이 포함되어야 함(숨김 파일이므로 터미널로 올리는 것을 권장):
   ```bash
   cd glassbox-lab && git init && git add -A && git commit -m "Glassbox Lab" && git branch -M main
   git remote add origin https://github.com/patbing/glassbox-lab.git && git push -u origin main
   ```
3. **GitHub Pages 켜기**: 저장소 Settings → Pages → Branch `main` / `/ (root)` → Save. 주소: `https://patbing.github.io/glassbox-lab/`
4. **App Key 만들기**: https://enter.pollinations.ai/keys → Apps → Create. Redirect URI에 Pages 주소(`https://patbing.github.io/glassbox-lab/`)와 `http://localhost:8123` 추가. 생성된 **공개 키 `pk_...`** 를 `js/pollinations.js` 맨 위 `CONFIG.APP_KEY` 에 붙여넣고 커밋/푸시.
5. **라이브 확인 (체크리스트)**: 배포된 주소에서 (a) 갤러리 4개 열림 (b) `?demo=1` 빌드 끝까지 됨 (c) 상단 Connect → 로그인 → 실제 주제 하나 빌드(비용 미리보기 → 완료) (d) 투어 "Listen" 동작 (e) 오프라인 HTML 다운로드 후 열림. 문제 있으면 브라우저 콘솔 메시지를 Claude에게 보여주세요.
6. **폼 제출**: Pollinations 앱 제출 폼에 아래 내용 입력 (Quest `#19181`).

## 2. 폼 초안
- App name: **Glassbox Lab**
- Short description: Type a science topic and get a live simulation with sliders, a guided tour, predict-then-test questions checked by the simulation itself, and Wikipedia sources. BYOP.
- App URL: `https://patbing.github.io/glassbox-lab/`
- Repository: `https://github.com/patbing/glassbox-lab`
- Quest: `#19181`
- How it uses Pollinations: Users connect with polli-connect (BYOP) and pay with their own Pollen. A text model (gen.pollinations.ai/v1/chat/completions) writes each lesson as a declarative simulation model plus tour, predictions and cited claims. A second text model reviews it. The image endpoint makes a cover illustration and /v1/audio/speech narrates the tour. Models are discovered live from /text/models. The gallery and demo mode work without an account.
- Notes for reviewers: Fastest look: open any gallery lesson (no sign-in) or add `?demo=1` to see the full generation pipeline offline, including automatic repair.

## 3. 알아둘 점
- 이 샌드박스에서는 gen.pollinations.ai에 접속할 수 없어 **실제 API 호출은 검증하지 못했습니다.** 요청 형식은 설계서(DESIGN.md §1.3)의 가정에 맞춰 관대하게(모델 자동 탐색, response_format/max_tokens 폴백, 실패 시 기기 음성/커버 생략) 만들었습니다. 5번 라이브 확인이 그래서 중요합니다.
- 경쟁작(#19281)이 이미 제출되어 있으므로 폼의 reviewer 메모(갤러리·데모로 바로 검증 가능)가 핵심 차별점입니다.
- `docs/screenshot.png`는 README용입니다. 라이브 확인 후 실제 화면으로 교체하면 더 좋습니다.
