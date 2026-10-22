# 🌿 Biosphere

**An ecosystem that lives in your browser.** Pixel-art creatures, each with a tiny artificial brain (a neural network), learn on their own to eat, hunt and flee. Nobody programs their behavior: they evolve, generation after generation.

👉 **[Try the live demo](https://riccdev06.github.io/biosphere/)**

<!-- Add a GIF of the simulation here: ![Biosphere in action](demo.gif) -->

## How it works

- **Herbivores** (blue) look for plants and run from predators.
- **Predators** (coral) chase herbivores.
- **Plants** grow in the fertile oases of the world.

Every creature has a neural network with 8 inputs (direction and distance of food and danger, plus energy), 6 hidden neurons and 2 outputs (steering and speed). At first the brains are random, so creatures wander aimlessly. Those that find food gain energy and reproduce; offspring inherit their parent's brain with small mutations. After a few hundred generations, behaviors like chasing, fleeing and patrolling oases emerge.

Tap any creature to watch its brain think in real time.

## Shareable worlds

Every world grows from a code (e.g. `quiet-swamp-37`). Same code, same starting world: add it to the link to share yours.

```
https://riccdev06.github.io/biosphere/#quiet-swamp-37
```

## Run it locally

No dependencies, no build step: just open `index.html` in a browser.

## Ideas for contributions

- New species (omnivores, scavengers)
- Seasons and climate change
- Saving and exporting a creature's brain
- A family tree of evolutionary lineages

## License

MIT
