# Auto-Exportica

> You alone can make it happen.

An idle factory game that runs in your browser. You start with one lonely ore gatherer and a stub of conveyor belt, and you build outward from there: mine raw materials, pipe them through machines that smelt and craft and combine, then sell whatever falls out the far end. Leave it running and it keeps working while you don't.

Play it at [auto-exportica.jack-sleath.dev](https://auto-exportica.jack-sleath.dev).

## How it plays

Everything lives on one big grid. You place machines, wire them together with belts, and items ride those belts from one machine to the next:

- **Spawners** are your resource nodes. An ore gatherer, a cow, a mine; each drips out one kind of raw item on a timer.
- **Belts** carry items one cell per tick. Pack them, branch them, back them up; they work out priority and back-pressure on their own, so nothing ever duplicates or vanishes.
- **Processors** take one thing and turn it into another (ore into a bar, milk into cheese). Feed one something with no recipe and you get junk, which is exactly as worthless as it sounds.
- **Combiners** take two things and make a third (a bar and a gem become an amulet).
- **Storage** hoards a single item type until you hit Sell All.
- **Sellers** quietly turn everything they're fed into money.

The money has a twist: there's a little stock market, and every item's price drifts up and down over time. Sell your diamonds when they spike, or automate the whole thing and stop watching. Prices can crash back to nothing too, so a warehouse full of something is not the same as money in the bank.

And because it is an idle game, it carries on while the tab is shut. Come back after a few hours and it works out roughly what your factory would have stockpiled and earned while you were gone, without pretending you were sat there catching every price wobble.

## Under the hood

It's a PWA, so you can install it and it runs offline. There's no backend: your game lives in the browser via localStorage, and you can export or import the whole save as a JSON file if you want to carry it between devices.

Built with Vite, React and TypeScript. The world is drawn on a Canvas 2D surface using emoji as sprites (Twemoji, rasterised and cached). Those are placeholders for now; proper art comes later, and the sprite source sits behind a small abstraction so that swap won't touch the renderer. State lives in a small Zustand store, and the simulation itself is a pure `step(state) -> state` function. That last part is the bit I'm quietly proud of, because the same tick engine that runs the live game also runs the offline catch-up, and the whole thing is unit-tested without a browser anywhere in sight.

## Running it locally

```bash
npm install
npm run dev      # local dev server
npm run test     # the vitest suite
npm run build    # typecheck + production build
```

## Where it came from

This started as a line in a notes file and got built one milestone at a time: a sparse infinite world and camera, then the tick engine and belts, then the machines, money, a stock market, offline progression, and a mobile polish pass. `MILESTONES.md` has the whole trail if you want it. Most ideas in that notes file never become anything. This one did.
