# WASM Solver Integration (v1)

## 1) Architecture (production-oriented)

- **Frontend (`CSPGraphEditorWeb.tsx`)**
  - builds graph model (`variables`, active `constraints`),
  - calls `runWasmConsistencyCheck(model)`,
  - consumes structured conflict diagnostics for UI/Conflict Inspector.
- **TypeScript adapter (`solver/wasmSolver.ts`)**
  - stable transport API for browser,
  - uses WASM (`window.CSPWasmSolver.checkConsistencyJson`) when possible,
  - uses TS fallback for `expr_rel` and no-WASM environments,
  - normalizes output into GUI-ready `SolverCheckResult`.
- **Normalizer (`solver/termNormalizer.ts`)**
  - converts graph terms to solver subset constraints,
  - reports unsupported constraints explicitly.
- **C++ core (`cpp/solver/solver_core.cpp`)**
  - queue-based propagation for GAC-style consistency checking,
  - records value-removal explanations,
  - reconstructs + greedily reduces conflict core,
  - emits conflict-analysis payload (participation, ranking, propagation trail).
- **WASM binding boundary (Embind)**
  - single pure JSON function (`checkConsistencyJson`),
  - backend-ready design (same JSON contract can be reused by native service wrappers).

## 2) Input model contract

Defined in `solver/solverTypes.ts`:

- `SolverModel`
  - `variables[]` with discrete numeric domains,
  - `constraints[]` with typed payloads (`unary_bound`, `binary_rel`, `binary_rel_offset`, `all_different`, `expr_rel`),
  - optional metadata/options fields.

## 3) Output/result contract (GUI conflict-inspector ready)

`SolverCheckResult` includes:

- **Status**: `ok | inconsistent | unsupported | error`
- **Consistency flag**
- **Reduced domains** (`reducedDomains`)
- **Value removals** (`removals`) with explanation
- **Propagation timeline** (`propagationSteps`)
- **Conflict core** (`conflict`) with wipeout variable and reduced core IDs
- **Conflict analysis** (`conflictAnalysis`)
  - `core`
  - `participation` (direct/indirect constraints+variables)
  - `propagationTrail`
  - `causeRanking` (simple relevance score)
- **Unsupported constraints** (`unsupportedConstraints`)

This contract is designed for direct use by a future Conflict Inspector UI.

## 4) Supported solver subset (v1)

- Unary bounds: `X < c`, `X <= c`, `X > c`, `X >= c`, `X == c`, `X != c`
- Binary relations: `X < Y`, `X <= Y`, `X > Y`, `X >= Y`, `X == Y`, `X != Y`
- Affine offsets: `X == Y + c`, `X + c1 <= Y + c2`, `X - c >= 0`
- Conjunction: `atom AND atom AND ...`
- Global shorthand: `allDifferent(X,Y,...)`
- Expression relations (`expr_rel`) with allowed comparison operators are solved via TS fallback
  (e.g. `X == X2 + 200`, `sin(X) <= Y + 3`).

## 5) Build (WASM)

```bash
cd cpp/solver
./build_wasm.sh
```

Load generated `public/solver/solver_wasm.js` and `solver_wasm.wasm` in the web app.
