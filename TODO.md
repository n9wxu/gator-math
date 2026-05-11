# Gator Math — Known Issues & TODO

## Sprites (fix before next art pass)
- [ ] **hero.png**: frame 5 (last, index 5) is a ghost/transparency fade artifact — remove or redraw
- [ ] **heroine.png**: frame 4 (last) is a ghost artifact — same issue
- [ ] Hero/heroine are purely cosmetic swing animations; low game-play priority for fixes

## Background
- [ ] Scroll seam sometimes visible at wrap point (streamOffset wraps at 960); need crossfade or seamless tile
- [ ] background_1.png, background_2.png, background_3.png available as alternatives/parallax layers
- [ ] Consider true parallax: distant trees at 0.3× speed, mid vines at 0.7×, foreground at 1.2×
- [ ] Smooth out grass reed edges at stream top/bottom borders

## Audio
- [ ] Add sound effects: correct eat chime, wrong eat buzz, level up fanfare, steal whoosh, bird squawk
- [ ] Web Audio API (no dependencies) or Howler.js

## Gameplay Polish
- [ ] Screen shake on bad eat / life lost (currently box-shadow flash only)
- [ ] Confetti particle burst when reaching level 7 milestone
- [ ] Bird sprite whitespace crop: bird.png has large transparent padding; consider cropping source rect
- [ ] Steal zone touch detection on mobile could be more forgiving (larger tap target)
- [ ] Name entry: prevent empty / whitespace-only names
- [ ] Game over: show final score alongside final level

## Multiplayer
- [ ] Handle 5th+ player gracefully (lane overflow — currently random lane shared)
- [ ] Show disconnect reason if server drops

## Performance
- [ ] Apple arc animation: could be offloaded to Web Worker if needed
- [ ] Consider requestAnimationFrame throttle on low-battery mobile

## Future Features
- [ ] Power-up: "shield" that blocks one bad apple (earned at 5-in-a-row?)
- [ ] Difficulty selector at name entry (Easy / Normal / Hard)
- [ ] Timed challenge mode (60 seconds, highest score wins)
- [ ] Sound toggle button
