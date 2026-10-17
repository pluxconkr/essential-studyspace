# StudySpace production-ready pass

User brief (verbatim):
지금 가지고 있는 플러그인과 스킬을 전부 파악해. 지금 이 프로덕트가 실제로 내가 준 독스에 비해서 부족한점이 무엇이 있는지 확인하고 파악해. 그리고 디자인이 괜찮은지 안괜찮은지, 프로덕션 앱처럼 보이는지 안보이는지 전수 조사해서 실제 iOS 앱 처럼 디자인 consistency랑 방향성을 확립하고, 폰트 크기 등을 통일해서 전체적으로 통일감 있는 앱을 만들어. 전체적으로 개발하여 최적화까지 마친다음에, 내가 실제로 작업해야되는 백엔드 정보들만 요청해서 내가 .env.local에 넣어주면 작동할 수 있도록 해봐.

Context: StudySpace v1 (Expo SDK 57, local-first, same design system as ../nmi-typhoon-watch) was built on 2026-10-03 from the spec at ../docs/2_NewJersey_1.HTM. All checks (tsc, lint, 67 jest tests, web export, simulator screenshots) pass. This run takes it from "works" to "ships": tooling inventory, spec gap analysis, iOS design consistency, Phase-1 gap closure, optimization, and a backend handoff so the app runs from .env.local alone.
