# Contributing to Biosphere

Thanks for wanting to help! Biosphere is a small project with no build step, so you can be running it in a minute.

## Run it

```bash
git clone https://github.com/riccdev06/biosphere
cd biosphere
python3 -m http.server 8000      # or: npm start
# open http://localhost:8000
```

ES modules and Web Workers need a local server, so opening `index.html` straight from disk won't work.

## Test it

```bash
npm test
```

The tests use Node's built-in test runner (Node 18 or newer) and need no installs. The last test grows a world for four days and checks that evolved brains beat random ones, so it takes about a minute.

## How the code fits together

| File | What it does |
|---|---|
| `js/sim.js` | The whole simulation: terrain, species, brains, genes, climate, the intelligence test, saving. No DOM, so it runs in Node too. |
| `js/worker.js` | Runs the simulation in a background thread and sends snapshots to the page. Also replays the time you were away. |
| `js/render.js` | Draws snapshots as pixels: terrain, creatures, weather, effects and the camera. |
| `js/charts.js` | The brain diagram and the small charts. |
| `js/audio.js` | Synthesized ambient sound. |
| `js/main.js` | Everything you click: tabs, tools, the guide, the postcard, champions. |

A creature's brain is a tiny recurrent network: 14 senses, 8 hidden neurons and 3 outputs (steer, speed, memory). Children copy their parent's brain with small random changes. Nothing is trained with gradients; everything comes from who survives long enough to have children.

## Changing the balance

Species settings live in `KINDS` at the top of `js/sim.js`. Small changes have big effects, so measure before and after. A handy check is to grow a few worlds in Node for a year (24,000 ticks) and count how often a species needs a rescue migration. Fewer rescues means the ecosystem holds itself together. The last test in `test/sim.test.mjs` fails if rescues get out of hand.

## Pull requests

- Keep it dependency-free: plain JavaScript modules, no bundler.
- Run `npm test` before you open the PR.
- For anything visual, add a screenshot or a short GIF to the PR.
- Saves are versioned (`v` in `World.toJSON`). If you change the save format, bump the version so old saves start a fresh world instead of breaking.

Not sure where to start? Look at the issues labelled **good first issue**.
