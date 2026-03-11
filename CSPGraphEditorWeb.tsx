export type DomainValue = number;

export type SolverVariable = {
  id: string;
  name: string;
  domain: DomainValue[];
};

export type SolverConstraintType = "binary_rel" | "binary_rel_offset" | "unary_bound" | "all_different" | "expr_rel" | "expr_bool";

export type BinaryRelPayload = {
  leftVarId: string;
  rightVarId: string;
  op: "<" | "<=" | ">" | ">=" | "==" | "!=";
  offset?: number;
};

export type UnaryBoundPayload = {
  varId: string;
  op: "<" | "<=" | ">" | ">=" | "==" | "!=";
  constant: number;
};

export type AllDifferentPayload = {
  varIds: string[];
};

export type ExprRelPayload = {
  varIds: string[];
  leftExpr: string;
  rightExpr: string;
  op: "<" | "<=" | ">" | ">=" | "==" | "!=";
};

export type ExprBoolPayload = {
  varIds: string[];
  expr: string;
};

export type SolverConstraint = {
  id: string;
  name: string;
  active: boolean;
  scope: string[];
  type: SolverConstraintType;
  payload: BinaryRelPayload | UnaryBoundPayload | AllDifferentPayload | ExprRelPayload | ExprBoolPayload;
  meta?: Record<string, unknown>;
};

export type SolverModel = {
  version: 1;
  variables: SolverVariable[];
  constraints: SolverConstraint[];
  options?: {
    fullRebuild?: boolean;
    incrementalHint?: boolean;
    autoRecompute?: boolean;
  };
  meta?: Record<string, unknown>;
};

export type ValueRemoval = {
  step: number;
  variableId: string;
  value: number;
  byConstraintId: string;
  reason: string;
};

export type PropagationStep = {
  step: number;
  kind: "value_removed" | "domain_wipeout";
  variableId: string;
  constraintId: string;
  value?: number;
  reason: string;
  impactedVariableIds: string[];
};

export type ConflictCauseScore = {
  constraintId: string;
  score: number;
  direct: boolean;
};

export type ConflictParticipation = {
  directConstraintIds: string[];
  indirectConstraintIds: string[];
  directVariableIds: string[];
  indirectVariableIds: string[];
};

export type ConflictCore = {
  wipeoutVariableId: string;
  constraintIds: string[];
  variableIds: string[];
  reducedByGreedy: boolean;
};

export type ConflictAnalysis = {
  core: ConflictCore;
  participation: ConflictParticipation;
  propagationTrail: PropagationStep[];
  causeRanking: ConflictCauseScore[];
};

export type SolverCheckResult = {
  status: "ok" | "inconsistent" | "unsupported" | "error";
  consistent: boolean;
  reducedDomains?: Record<string, number[]>;
  removals: ValueRemoval[];
  unsupportedConstraints?: string[];
  message?: string;
  conflict?: ConflictCore;
  conflictAnalysis?: ConflictAnalysis;
  propagationSteps?: PropagationStep[];
};

export type DomainRepairChange = {
  variableId: string;
  suggestedDomain: string;
};

export type DomainRepairSuggestion = {
  variableId: string;
  suggestedDomain: string;
  score: number;
  explanation: string;
  expectedStatus: SolverCheckResult["status"];
  changes: DomainRepairChange[];
};

export type DomainRepairOptions = {
  maxChangedVariables?: number;
  maxSuggestions?: number;
  maxValuesPerVariable?: number;
  disabledConstraintIds?: string[];
};

export type SearchAlgorithm =
  | "backtracking"
  | "backjumping"
  | "backmarking"
  | "forward_checking_gac"
  | "mac_gac"
  | "minimum_conflicts";

export type SearchSolveOptions = {
  algorithm: SearchAlgorithm;
};

export type SearchSolveResult = {
  status: "ok" | "inconsistent" | "unsupported" | "error";
  algorithm: SearchAlgorithm;
  message?: string;
  assignment: Record<string, number>;
  visitedNodes: number;
  unsupportedConstraints?: string[];
};

const pageStyle = {
  fontFamily: "Inter, system-ui, sans-serif",
  padding: "24px",
  lineHeight: "1.4",
  color: "#111827",
};

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  padding: "16px",
  marginTop: "16px",
  backgroundColor: "#ffffff",
};

const listStyle = {
  margin: "8px 0 0 20px",
};

const CSPGraphEditorWeb = () => (
  <main style={pageStyle}>
    <h1 style={{ margin: 0 }}>CSP Modeling Interface</h1>
    <p style={{ marginTop: "8px" }}>
      Frontend-Grundgerüst ist aktiv. Die Solver-Typen und die WASM-Adapter sind eingebunden.
    </p>

    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Lösungssuche (vorbereitet)</h2>
      <p style={{ marginBottom: 0 }}>Verfügbare Algorithmus-Optionen:</p>
      <ul style={listStyle}>
        <li>Backtracking</li>
        <li>Backjumping</li>
        <li>Backmarking</li>
        <li>Forward Checking mit GAC</li>
        <li>MAC mit GAC</li>
        <li>Minimum Conflicts</li>
      </ul>
    </section>
  </main>
);

export default CSPGraphEditorWeb;
