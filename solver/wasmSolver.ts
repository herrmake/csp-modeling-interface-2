import type {
  SearchSolveOptions,
  SearchSolveResult,
  SolverCheckResult,
  SolverModel,
} from "../CSPGraphEditorWeb";

type WasmSolverApi = {
  checkConsistencyJson?: (inputJson: string) => string;
  solveSearchJson?: (inputJson: string) => string;
};

declare global {
  interface Window {
    CSPWasmSolver?: WasmSolverApi;
  }
}

const SEARCH_ALGORITHMS: SearchSolveOptions["algorithm"][] = [
  "backtracking",
  "backjumping",
  "backmarking",
  "forward_checking_gac",
  "mac_gac",
  "minimum_conflicts",
];

function getWasmApi(): WasmSolverApi | undefined {
  if (typeof window === "undefined") return undefined;
  return window.CSPWasmSolver;
}

export function getSearchAlgorithmOptions(): SearchSolveOptions["algorithm"][] {
  return [...SEARCH_ALGORITHMS];
}

export function estimateSearchRuntime(model: SolverModel): { variableCount: number; domainProductEstimate: number } {
  const variableCount = model.variables.length;
  const domainProductEstimate = model.variables.reduce((acc, variable) => {
    const size = Math.max(1, variable.domain.length);
    if (acc > Number.MAX_SAFE_INTEGER / size) return Number.MAX_SAFE_INTEGER;
    return acc * size;
  }, 1);

  return { variableCount, domainProductEstimate };
}

export async function runWasmConsistencyCheck(model: SolverModel): Promise<SolverCheckResult> {
  const wasm = getWasmApi();
  if (!wasm?.checkConsistencyJson) {
    return {
      status: "error",
      consistent: false,
      message: "WASM-Solver ist nicht geladen",
      removals: [],
      unsupportedConstraints: [],
    };
  }

  try {
    const raw = wasm.checkConsistencyJson(JSON.stringify(model));
    const parsed = JSON.parse(raw ?? "{}") as Partial<SolverCheckResult>;

    return {
      status: parsed.status ?? "error",
      consistent: Boolean(parsed.consistent),
      message: parsed.message,
      removals: parsed.removals ?? [],
      reducedDomains: parsed.reducedDomains,
      unsupportedConstraints: parsed.unsupportedConstraints ?? [],
      conflict: parsed.conflict,
      conflictAnalysis: parsed.conflictAnalysis,
      propagationSteps: parsed.propagationSteps,
    };
  } catch (error) {
    return {
      status: "error",
      consistent: false,
      message: error instanceof Error ? error.message : "Fehler bei der Konsistenzprüfung",
      removals: [],
      unsupportedConstraints: [],
    };
  }
}

export async function runWasmSearchSolve(
  model: SolverModel,
  options: SearchSolveOptions,
): Promise<SearchSolveResult> {
  if (!SEARCH_ALGORITHMS.includes(options.algorithm)) {
    return {
      status: "error",
      algorithm: options.algorithm,
      message: "Unbekannter Suchalgorithmus",
      assignment: {},
      visitedNodes: 0,
      unsupportedConstraints: [],
    };
  }

  const wasm = getWasmApi();
  if (!wasm?.solveSearchJson) {
    return {
      status: "error",
      algorithm: options.algorithm,
      message: "WASM-Solver ist nicht geladen",
      assignment: {},
      visitedNodes: 0,
      unsupportedConstraints: [],
    };
  }

  try {
    const raw = wasm.solveSearchJson(JSON.stringify({ model, options }));
    const parsed = JSON.parse(raw ?? "{}") as Partial<SearchSolveResult>;

    return {
      status: parsed.status ?? "error",
      algorithm: (parsed.algorithm as SearchSolveOptions["algorithm"]) ?? options.algorithm,
      message: parsed.message,
      assignment: parsed.assignment ?? {},
      visitedNodes: Number(parsed.visitedNodes ?? 0),
      unsupportedConstraints: parsed.unsupportedConstraints ?? [],
    };
  } catch (error) {
    return {
      status: "error",
      algorithm: options.algorithm,
      message: error instanceof Error ? error.message : "Unbekannter Fehler bei der Lösungssuche",
      assignment: {},
      visitedNodes: 0,
      unsupportedConstraints: [],
    };
  }
}
