# 🌿 Biosphere

**Your own little world, living in your browser.** Pixel-art creatures with tiny neural-network brains learn to graze, hunt and flee through day and night, spring and winter. Nobody programs their behavior: it evolves.

Every visitor gets their own world. It is saved in the browser, and **it keeps evolving while you're away**: come back after a few hours and Biosphere tells you what happened. Who was born, which family lines took over, which ones died out.

👉 **[Grow your world](https://riccdev06.github.io/biosphere/)**

<!-- Add a GIF of the simulation here: ![Biosphere in action](demo.gif) -->

## What's inside

- **A living landscape.** Lakes, meadows, sand and rock generated from a seed, wrapping around at the edges like a little planet.
- **Day and night.** Creatures see less in the dark, and predators lose less sight than their prey.
- **Seasons.** Plants boom in spring and wither in winter, so populations rise and crash in real cycles.
- **Herbivores and predators.** Herbivores eat plants and berries. Predators hunt herbivores and scavenge carrion, but can't take down prey much bigger than themselves.
- **Evolving genes.** Size, speed and sight are inherited and mutate. Bigger bodies store more energy and resist predators; speed and sight burn energy every step.
- **Evolving brains.** Each creature has a recurrent neural network: 14 senses (food, danger, kin, water, energy, memory), 8 hidden neurons and 3 outputs (steer, speed, memory). Offspring inherit their parent's brain with small mutations.
- **Carrion and soil.** Bodies that aren't eaten decay into fertile ground where plants grow back faster.
- **Family lines.** Every founder starts a named line. Watch lines spread, dominate and go extinct.
- **Inspect anything.** Tap a creature to see its genes and watch its brain fire live, then follow it around the map.
- **Play god.** Scatter plants, release a herd or a pack, and see how the world reacts.

## Share a world

Every world grows from a code like `quiet-swamp-37`. Same code, same land and same first creatures:

```
https://riccdev06.github.io/biosphere/#quiet-swamp-37
```

## Run it locally

No build step and no dependencies, but ES modules need a local server:

```bash
python3 -m http.server
# then open http://localhost:8000
```

## Project structure

```
index.html        page layout
css/style.css     styles
js/sim.js         simulation engine (no DOM, also runs in Node)
js/render.js      pixel renderer, camera and effects
js/charts.js      brain diagram and charts
js/storage.js     saving your world in localStorage
js/main.js        interface, controls and the "while you were away" catch-up
```

## Ideas for contributions

- New species (omnivores, scavengers, flyers)
- Weather events like droughts and floods
- Export and import a creature's brain
- A visual family tree of lineages
- Run the simulation in a Web Worker for bigger worlds

## License

MIT
