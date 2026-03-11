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
