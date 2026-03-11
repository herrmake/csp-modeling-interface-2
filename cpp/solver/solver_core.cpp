#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <algorithm>
#include <cmath>
#include <deque>
#include <limits>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace emscripten;

namespace csp {

static bool approxEq(double a, double b) { return std::fabs(a - b) < 1e-9; }

struct Constraint {
  std::string id;
  std::string sourceId;
  std::string type;
  std::string op;
  std::string a;
  std::string b;
  double constant = 0.0;
  double offset = 0.0;
  std::vector<std::string> scope;
};

struct Removal {
  int step = 0;
  std::string variableId;
  double value = 0.0;
  std::string byConstraintId;
  std::string reason;
};

struct State {
  std::unordered_map<std::string, std::vector<double>> dom;
  std::vector<Constraint> constraints;
  std::vector<Removal> removals;
  int step = 0;
  std::string wipeoutVar;
  std::set<std::string> conflictCons;
};

struct SearchOptions {
  std::string algorithm = "backtracking";
};

struct SearchAssignment {
  std::unordered_map<std::string, double> values;
  bool complete = false;
  int visitedNodes = 0;
};

static bool evalRel(double x, double y, const std::string& op) {
  if (op == "<") return x < y;
  if (op == "<=") return x <= y || approxEq(x, y);
  if (op == ">") return x > y;
  if (op == ">=") return x > y || approxEq(x, y);
  if (op == "==") return approxEq(x, y);
  if (op == "!=") return !approxEq(x, y);
  return false;
}

static bool hasSupportUnary(double v, const Constraint& c) { return evalRel(v, c.constant, c.op); }

static bool hasSupportBinary(double va, const std::vector<double>& db, const Constraint& c) {
  for (double vb : db) if (evalRel(va, vb + c.offset, c.op)) return true;
  return false;
}

static std::vector<std::string> scopeVars(const Constraint& c) {
  std::vector<std::string> out;
  if (!c.a.empty()) out.push_back(c.a);
  if (!c.b.empty()) out.push_back(c.b);
  for (const auto& v : c.scope) out.push_back(v);
  std::sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}

static bool reviseConstraint(State& s, const Constraint& c) {
  bool changed = false;

  if (c.type == "unary_bound") {
    auto& d = s.dom[c.a];
    std::vector<double> keep;
    for (double v : d) {
      if (hasSupportUnary(v, c)) keep.push_back(v);
      else {
        changed = true;
        s.step += 1;
        s.removals.push_back({s.step, c.a, v, c.id, "Wert verletzt die einseitige Schranke"});
      }
    }
    d.swap(keep);
    if (d.empty()) {
      s.wipeoutVar = c.a;
      s.conflictCons.insert(c.id);
    }
    return changed;
  }

  if (c.type == "binary_rel" || c.type == "binary_rel_offset") {
    auto& da = s.dom[c.a];
    auto& db = s.dom[c.b];

    std::vector<double> keepA;
    for (double va : da) {
      if (hasSupportBinary(va, db, c)) keepA.push_back(va);
      else {
        changed = true;
        s.step += 1;
        s.removals.push_back({s.step, c.a, va, c.id, "Kein passender Partnerwert in der Domäne der Gegenvariable"});
      }
    }
    da.swap(keepA);

    std::vector<double> keepB;
    for (double vb : db) {
      bool ok = false;
      for (double va : da) {
        if (evalRel(va, vb + c.offset, c.op)) {
          ok = true;
          break;
        }
      }
      if (ok) keepB.push_back(vb);
      else {
        changed = true;
        s.step += 1;
        s.removals.push_back({s.step, c.b, vb, c.id, "Wert wird von keinem Partnerwert der Gegenvariable unterstützt"});
      }
    }
    db.swap(keepB);

    if (da.empty()) {
      s.wipeoutVar = c.a;
      s.conflictCons.insert(c.id);
    }
    if (db.empty()) {
      s.wipeoutVar = c.b;
      s.conflictCons.insert(c.id);
    }
    return changed;
  }

  if (c.type == "all_different") {
    bool localChanged = false;
    for (size_t i = 0; i < c.scope.size(); ++i) {
      for (size_t j = i + 1; j < c.scope.size(); ++j) {
        Constraint d;
        d.id = c.id;
        d.type = "binary_rel";
        d.op = "!=";
        d.a = c.scope[i];
        d.b = c.scope[j];
        localChanged = reviseConstraint(s, d) || localChanged;
      }
    }
    return localChanged;
  }

  return false;
}

static bool propagate(State& s, const std::vector<Constraint>& constraints) {
  std::deque<size_t> q;
  for (size_t i = 0; i < constraints.size(); ++i) q.push_back(i);

  while (!q.empty()) {
    size_t idx = q.front();
    q.pop_front();
    const auto& c = constraints[idx];
    bool ch = reviseConstraint(s, c);
    if (!s.wipeoutVar.empty()) return false;
    if (ch) {
      for (size_t k = 0; k < constraints.size(); ++k) {
        if (k != idx) q.push_back(k);
      }
    }
  }
  return true;
}

static State loadFromJsonVal(val model, std::vector<std::string>& unsupported) {
  State s;

  val vars = model["variables"];
  const unsigned vlen = vars["length"].as<unsigned>();
  for (unsigned i = 0; i < vlen; ++i) {
    val v = vars[i];
    std::string id = v["id"].as<std::string>();
    val dom = v["domain"];
    unsigned dlen = dom["length"].as<unsigned>();
    std::vector<double> dd;
    for (unsigned j = 0; j < dlen; ++j) dd.push_back(dom[j].as<double>());
    s.dom[id] = dd;
  }

  val cons = model["constraints"];
  const unsigned clen = cons["length"].as<unsigned>();
  for (unsigned i = 0; i < clen; ++i) {
    val c = cons[i];
    Constraint cc;
    cc.id = c["id"].as<std::string>();
    cc.sourceId = c.hasOwnProperty(std::string("meta")) ? c["meta"]["sourceConstraintId"].as<std::string>() : cc.id;
    cc.type = c["type"].as<std::string>();
    if (cc.type == "unary_bound") {
      val p = c["payload"];
      cc.a = p["varId"].as<std::string>();
      cc.op = p["op"].as<std::string>();
      cc.constant = p["constant"].as<double>();
    } else if (cc.type == "binary_rel" || cc.type == "binary_rel_offset") {
      val p = c["payload"];
      cc.a = p["leftVarId"].as<std::string>();
      cc.b = p["rightVarId"].as<std::string>();
      cc.op = p["op"].as<std::string>();
      cc.offset = p.hasOwnProperty(std::string("offset")) ? p["offset"].as<double>() : 0.0;
    } else if (cc.type == "all_different") {
      val p = c["payload"];
      val arr = p["varIds"];
      unsigned n = arr["length"].as<unsigned>();
      for (unsigned k = 0; k < n; ++k) cc.scope.push_back(arr[k].as<std::string>());
    } else {
      unsupported.push_back(cc.id);
      continue;
    }
    s.constraints.push_back(cc);
  }

  return s;
}

static bool runWithConstraintSubset(const State& base, const std::set<std::string>& keep) {
  State t;
  t.dom = base.dom;
  std::vector<Constraint> subset;
  for (const auto& c : base.constraints) {
    if (keep.count(c.id)) subset.push_back(c);
  }
  return propagate(t, subset);
}

static bool isConstraintSatisfiedByAssignment(
    const Constraint& c,
    const std::unordered_map<std::string, double>& assignment,
    bool requireComplete) {
  if (c.type == "unary_bound") {
    auto it = assignment.find(c.a);
    if (it == assignment.end()) return !requireComplete;
    return evalRel(it->second, c.constant, c.op);
  }

  if (c.type == "binary_rel" || c.type == "binary_rel_offset") {
    auto itA = assignment.find(c.a);
    auto itB = assignment.find(c.b);
    if (itA == assignment.end() || itB == assignment.end()) return !requireComplete;
    return evalRel(itA->second, itB->second + c.offset, c.op);
  }

  if (c.type == "all_different") {
    std::unordered_set<double> seen;
    for (const auto& varId : c.scope) {
      auto it = assignment.find(varId);
      if (it == assignment.end()) {
        if (requireComplete) return false;
        continue;
      }
      if (seen.count(it->second)) return false;
      seen.insert(it->second);
    }
    return true;
  }

  return false;
}

static std::string chooseNextUnassignedVar(
    const State& s,
    const std::unordered_map<std::string, double>& assignment) {
  std::string best;
  size_t bestDomain = std::numeric_limits<size_t>::max();
  for (const auto& it : s.dom) {
    if (assignment.count(it.first)) continue;
    if (it.second.size() < bestDomain) {
      bestDomain = it.second.size();
      best = it.first;
    }
  }
  return best;
}

static bool violatesAnyConstraintEarly(const State& s, const std::unordered_map<std::string, double>& assignment) {
  for (const auto& c : s.constraints) {
    if (!isConstraintSatisfiedByAssignment(c, assignment, false)) return true;
  }
  return false;
}

static bool allConstraintsSatisfied(const State& s, const std::unordered_map<std::string, double>& assignment) {
  for (const auto& c : s.constraints) {
    if (!isConstraintSatisfiedByAssignment(c, assignment, true)) return false;
  }
  return true;
}

static bool backtrackSearch(
    const State& s,
    std::unordered_map<std::string, double>& assignment,
    SearchAssignment& result) {
  result.visitedNodes += 1;
  if (assignment.size() == s.dom.size()) {
    if (allConstraintsSatisfied(s, assignment)) {
      result.values = assignment;
      result.complete = true;
      return true;
    }
    return false;
  }

  std::string nextVar = chooseNextUnassignedVar(s, assignment);
  if (nextVar.empty()) return false;

  auto dIt = s.dom.find(nextVar);
  if (dIt == s.dom.end()) return false;

  std::vector<double> domain = dIt->second;
  std::sort(domain.begin(), domain.end());

  for (double value : domain) {
    assignment[nextVar] = value;
    if (!violatesAnyConstraintEarly(s, assignment)) {
      if (backtrackSearch(s, assignment, result)) return true;
    }
    assignment.erase(nextVar);
  }

  return false;
}

static val buildReducedDomains(const State& s) {
  val out = val::object();
  for (const auto& it : s.dom) {
    val arr = val::array();
    std::vector<double> sorted = it.second;
    std::sort(sorted.begin(), sorted.end());
    for (unsigned i = 0; i < sorted.size(); ++i) arr.set(i, sorted[i]);
    out.set(it.first, arr);
  }
  return out;
}

static val buildPropagationSteps(const State& s, const std::unordered_map<std::string, Constraint>& byId) {
  val steps = val::array();
  unsigned idx = 0;
  for (const auto& r : s.removals) {
    val o = val::object();
    o.set("step", r.step);
    o.set("kind", std::string("value_removed"));
    o.set("variableId", r.variableId);
    o.set("constraintId", r.byConstraintId);
    o.set("value", r.value);
    o.set("reason", r.reason);

    val impacted = val::array();
    auto it = byId.find(r.byConstraintId);
    if (it != byId.end()) {
      auto vars = scopeVars(it->second);
      for (unsigned vi = 0; vi < vars.size(); ++vi) impacted.set(vi, vars[vi]);
    }
    o.set("impactedVariableIds", impacted);
    steps.set(idx++, o);
  }

  if (!s.wipeoutVar.empty()) {
    val w = val::object();
    w.set("step", s.step + 1);
    w.set("kind", std::string("domain_wipeout"));
    w.set("variableId", s.wipeoutVar);
    w.set("constraintId", std::string(""));
    w.set("reason", std::string("Domäne wurde leer"));
    w.set("impactedVariableIds", val::array());
    steps.set(idx, w);
  }

  return steps;
}

static val buildConflictAnalysis(
    const State& s,
    const std::set<std::string>& reduced,
    const std::unordered_map<std::string, Constraint>& byId,
    const val& propagationSteps) {
  val analysis = val::object();

  std::set<std::string> directCons = reduced;
  std::set<std::string> indirectCons;
  std::set<std::string> directVars;
  std::set<std::string> indirectVars;
  std::unordered_map<std::string, int> constraintRemovalCount;

  for (const auto& cid : directCons) {
    auto it = byId.find(cid);
    if (it == byId.end()) continue;
    for (const auto& v : scopeVars(it->second)) directVars.insert(v);
  }
  if (!s.wipeoutVar.empty()) directVars.insert(s.wipeoutVar);

  for (const auto& r : s.removals) {
    constraintRemovalCount[r.byConstraintId] += 1;
    if (directCons.count(r.byConstraintId) == 0) indirectCons.insert(r.byConstraintId);
    if (directVars.count(r.variableId) == 0) indirectVars.insert(r.variableId);
  }

  val participation = val::object();
  val directC = val::array();
  val indirectC = val::array();
  val directV = val::array();
  val indirectV = val::array();

  unsigned i = 0;
  for (const auto& c : directCons) directC.set(i++, c);
  i = 0;
  for (const auto& c : indirectCons) indirectC.set(i++, c);
  i = 0;
  for (const auto& v : directVars) directV.set(i++, v);
  i = 0;
  for (const auto& v : indirectVars) indirectV.set(i++, v);

  participation.set("directConstraintIds", directC);
  participation.set("indirectConstraintIds", indirectC);
  participation.set("directVariableIds", directV);
  participation.set("indirectVariableIds", indirectV);

  std::vector<std::pair<std::string, int>> ranked(constraintRemovalCount.begin(), constraintRemovalCount.end());
  std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) {
    if (a.second != b.second) return a.second > b.second;
    return a.first < b.first;
  });

  val causeRanking = val::array();
  for (unsigned ri = 0; ri < ranked.size(); ++ri) {
    val o = val::object();
    o.set("constraintId", ranked[ri].first);
    o.set("score", ranked[ri].second);
    o.set("direct", directCons.count(ranked[ri].first) > 0);
    causeRanking.set(ri, o);
  }

  analysis.set("participation", participation);
  analysis.set("propagationTrail", propagationSteps);
  analysis.set("causeRanking", causeRanking);
  return analysis;
}

std::string checkConsistencyJson(const std::string& inputJson) {
  val JSON = val::global("JSON");
  val model = JSON.call<val>("parse", val(inputJson));

  std::vector<std::string> unsupported;
  State s = loadFromJsonVal(model, unsupported);

  bool ok = propagate(s, s.constraints);

  std::set<std::string> reduced = s.conflictCons;
  if (!ok && !s.wipeoutVar.empty()) {
    for (const auto& r : s.removals) {
      if (r.variableId == s.wipeoutVar) reduced.insert(r.byConstraintId);
    }
  }
  if (!ok && !reduced.empty()) {
    bool changed = true;
    while (changed) {
      changed = false;
      for (auto it = reduced.begin(); it != reduced.end();) {
        std::string rem = *it;
        std::set<std::string> trial = reduced;
        trial.erase(rem);
        bool trialOk = runWithConstraintSubset(s, trial);
        if (!trialOk) {
          it = reduced.erase(it);
          changed = true;
        } else {
          ++it;
        }
      }
    }
  }

  std::unordered_map<std::string, Constraint> byId;
  for (const auto& c : s.constraints) {
    if (!byId.count(c.id)) byId[c.id] = c;
  }

  val out = val::object();
  out.set("status", ok ? std::string("ok") : std::string("inconsistent"));
  out.set("consistent", ok);
  out.set("message", ok ? std::string("Konsistent nach GAC-Propagation") : std::string("Inkonsistenz erkannt (Domain-Wipeout)"));

  val rems = val::array();
  for (unsigned i = 0; i < s.removals.size(); ++i) {
    const auto& r = s.removals[i];
    val o = val::object();
    o.set("step", r.step);
    o.set("variableId", r.variableId);
    o.set("value", r.value);
    o.set("byConstraintId", r.byConstraintId);
    o.set("reason", r.reason);
    rems.set(i, o);
  }
  out.set("removals", rems);
  out.set("reducedDomains", buildReducedDomains(s));

  val propagationSteps = buildPropagationSteps(s, byId);
  out.set("propagationSteps", propagationSteps);

  val uns = val::array();
  for (unsigned i = 0; i < unsupported.size(); ++i) uns.set(i, unsupported[i]);
  out.set("unsupportedConstraints", uns);

  if (!ok) {
    val core = val::object();
    core.set("wipeoutVariableId", s.wipeoutVar);

    std::set<std::string> varSet;
    val cids = val::array();
    unsigned ci = 0;
    for (const auto& cid : reduced) {
      cids.set(ci++, cid);
      auto it = byId.find(cid);
      if (it != byId.end()) {
        for (const auto& v : scopeVars(it->second)) varSet.insert(v);
      }
    }
    core.set("constraintIds", cids);

    val vids = val::array();
    unsigned vi = 0;
    for (const auto& vid : varSet) vids.set(vi++, vid);
    core.set("variableIds", vids);
    core.set("reducedByGreedy", true);
    out.set("conflict", core);

    val analysis = buildConflictAnalysis(s, reduced, byId, propagationSteps);
    analysis.set("core", core);
    out.set("conflictAnalysis", analysis);
  }

  return JSON.call<std::string>("stringify", out);
}

std::string solveSearchJson(const std::string& inputJson) {
  val JSON = val::global("JSON");
  val input = JSON.call<val>("parse", val(inputJson));
  val model = input["model"];

  SearchOptions options;
  if (input.hasOwnProperty(std::string("options")) && input["options"].hasOwnProperty(std::string("algorithm"))) {
    options.algorithm = input["options"]["algorithm"].as<std::string>();
  }

  std::vector<std::string> unsupported;
  State s = loadFromJsonVal(model, unsupported);

  val out = val::object();
  out.set("algorithm", options.algorithm);

  if (options.algorithm != "backtracking") {
    out.set("status", std::string("unsupported"));
    out.set("message", std::string("Algorithmus ist vorbereitet, aber noch nicht implementiert"));
    out.set("visitedNodes", 0);
    out.set("assignment", val::object());
    out.set("unsupportedConstraints", val::array());
    return JSON.call<std::string>("stringify", out);
  }

  std::unordered_map<std::string, double> assignment;
  SearchAssignment result;
  bool solved = backtrackSearch(s, assignment, result);

  out.set("status", solved ? std::string("ok") : std::string("inconsistent"));
  out.set("message", solved ? std::string("Lösung mit Backtracking gefunden") : std::string("Keine Lösung mit Backtracking gefunden"));
  out.set("visitedNodes", result.visitedNodes);

  val assign = val::object();
  if (solved) {
    std::vector<std::string> keys;
    for (const auto& it : result.values) keys.push_back(it.first);
    std::sort(keys.begin(), keys.end());
    for (const auto& key : keys) assign.set(key, result.values[key]);
  }
  out.set("assignment", assign);

  val uns = val::array();
  for (unsigned i = 0; i < unsupported.size(); ++i) uns.set(i, unsupported[i]);
  out.set("unsupportedConstraints", uns);
  return JSON.call<std::string>("stringify", out);
}

}  // namespace csp

EMSCRIPTEN_BINDINGS(csp_solver_module) {
  function("checkConsistencyJson", &csp::checkConsistencyJson);
  function("solveSearchJson", &csp::solveSearchJson);
}
