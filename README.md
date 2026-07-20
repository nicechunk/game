# NiceChunk Game

This repository contains the NiceChunk browser game client and its game-facing chain integration.

## Repository Layout

- `play/`: game UI, input, runtime systems, chain synchronization, and tests.
- `src/`: shared game data, wallet support, world identifiers, and chain submission modules.
- `sdk/`: chain account and Guardian decoding used by the client.
- `public/`: runtime configuration, material rules, avatar assets, and locale JSON files.
- `chunk.js/`: pinned Chunk.js engine submodule.

## Setup

```bash
git submodule update --init --recursive
npm install
npm run check
npm run build
```

The production game is hosted inside the main NiceChunk website, which provides login and shared site routes. The game repository keeps only the runtime dependencies needed by `/play/`.
