# Title: Processors, Combiners, Recipes & Junk

<details>
<summary>Original Spec</summary>

## Milestone 4 — Processors, combiners, recipes & junk
**Goal:** Machines transform items using a recipe JSON, with junk as the fallback.

**Tasks:**
- Recipe lookup for a processor (1→1) and a combiner (order-independent pair → 1) from `recipes.json`.
- Processor pulls from the input side and emits to the output side in 1 tick; **holds if output blocked**.
- Combiner buffers one item per input side; when both are filled, it emits the recipe output; holds if output blocked.
- Any non-matching processing/pairing emits the configured junk item.

**Done when:**
- [ ] A valid processor recipe transforms the input; a blocked output makes it hold (no loss).
- [ ] A valid combiner recipe combines two inputs (either input order) into one output.
- [ ] An unprocessable input or non-recipe pairing produces junk.
</details>

## Technical Notes
- Recipes loaded from `recipes.json`: processor recipes (1 input → 1 output) and combiner recipes (order-independent input pair → 1 output).
- Processor is orientable (input side → opposite output side): pulls from the input side, emits to the output side within 1 tick, holds if the output is blocked.
- Combiner has two input sides + one output side: buffers one item per input side; when both are present it emits the matched recipe output; holds if the output is blocked.
- Junk item is configurable; emitted whenever a processor receives an unprocessable item or a combiner receives a pair with no matching recipe.

## Acceptance Criteria

### 1. Processor transforms a valid input
**GIVEN** a processor whose recipe maps input item A → output item B and a free output cell
**WHEN** item A arrives on the input side
**THEN** the processor consumes A and emits B on the output side within one tick.

### 2. Processor holds on blocked output (negative path)
**GIVEN** a processor that has transformed an input but whose output cell is occupied
**WHEN** the simulation advances
**THEN** the processor holds the item and does not lose or duplicate it, emitting once the output clears.

### 3. Combiner combines two inputs into one output
**GIVEN** a combiner whose recipe maps the pair (A, B) → C, with A on one input side and B on the other, and a free output
**WHEN** both input buffers are filled
**THEN** the combiner consumes A and B and emits C on the output side.

### 4. Combiner matches order-independently
**GIVEN** the same combiner recipe (A, B) → C
**WHEN** the inputs arrive in the reversed arrangement (B on the first side, A on the second)
**THEN** the combiner still produces C.

### 5. Combiner holds until both inputs and a free output are present
**GIVEN** a combiner with only one input side filled, or with both filled but a blocked output
**WHEN** the simulation advances
**THEN** the combiner holds its buffered item(s) without emitting or losing them.

### 6. Processor produces junk on an unprocessable input (negative path)
**GIVEN** a processor that receives an item with no matching processor recipe
**WHEN** the simulation advances
**THEN** the processor emits the configured junk item on its output side.

### 7. Combiner produces junk on a non-recipe pair (negative path)
**GIVEN** a combiner with both inputs filled by a pair that matches no combiner recipe
**WHEN** the simulation advances
**THEN** the combiner consumes both inputs and emits the configured junk item.

## Open Questions
- **MANUAL REVIEW:** Are a combiner's two inputs consumed atomically (both or neither), and must both buffers be full before either is consumed?
- **MANUAL REVIEW:** Is the junk item itself a sellable item with a market price, or valueless?
