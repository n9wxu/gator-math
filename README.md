# Gator Math

Multiplayer math-education arcade game. Alligators eat apples labeled with math problems in real-time swim lanes.

## Quick Start

```bash
npm install
node server.js
# open http://localhost:3000
```

## How to Play

- **Space / tap** — open mouth to eat apples
- **S key / tap steal zone** — steal apples from neighbors (earn by getting 3 correct in a row)
- Eat the apple whose math answer matches the number on your alligator's badge
- Get 5 correct apples to level up

## Level System

| Level | Operations | Animals |
|-------|-----------|---------|
| 1 | Addition | Monkey |
| 2 | Subtraction | Gorilla |
| 3 | Addition + Subtraction | Monkey + Gorilla |
| 4 | Multiplication | Orangutan |
| 5 | Add + Sub + Mul | Monkey + Gorilla + Orangutan |
| 6 | Division | Parrot |
| 7+ | All operations | All animals |

- Levels 1–6: 1 apple per second per lane
- Level 7+: speed increases, minimum 200ms between apples
- Level 10+: red bird occasionally steals a correct apple from your lane

## Steal Mechanic

Get **3 correct answers in a row** to earn steal ability. A glowing zone appears near each alligator. Press **S** (or tap the zone) to grab all opponent apples in the zone — good apples add points, bad apples subtract.

## Multiplayer

Up to 4 players, each assigned their own swim lane. Scores update live. Top 10 leaderboard shown on the right.

## Tech Stack

- Node.js + Express + Socket.io (real-time multiplayer)
- HTML5 Canvas (no framework)
- Sprite sheets: alligator, monkey, gorilla, orangutan, parrot, bird

## Known Issues

See [TODO.md](TODO.md) for sprite and gameplay fixes planned.
