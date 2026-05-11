# Formal verification of compliance rule packs

> Status: **pilot** — PSD2 SCA Article 97 and MiFID II suitability Article 25
> only. Other EU frameworks remain runtime-enforced rule packs (issue
> [#2042]).

This document is the auditor-facing reading guide for the
formal-verification artifact shipped under
`formal-verification-report.json`. It complements (does not replace)
the runtime compliance-as-code rule packs.

## Why formal verification?

Compliance rule packs encode regulatory obligations as machine-checkable
rules. The harness applies them as runtime checks during test-case
generation. That answers the **"did this run satisfy the rules?"**
question, but it does not answer two structurally different questions
that an auditor will ask:

1. **Are the rules internally consistent?** Two rules could
   contradict each other and the runtime would silently pick the
   first one that fires. Formal verification proves *no* contradiction
   is reachable in the rule-application order.
2. **Do the rules collectively satisfy the regulator's intent?**
   Regulators write prose obligations. The rule pack is one
   operational reading of that prose. Formal verification provides a
   mathematical proof that, under the modelled state machine, the
   regulator's intent is enforced — not just by a runtime checkpoint,
   but by **construction** of the rule pack.

We use **temporal logic** (LTL / CTL) as the bridge between the prose
obligation and the operational rule. Each obligation is lifted into a
temporal formula, and the formula is checked against a Kripke model of
the rule-application order.

## The pipeline at a glance

```
.smv spec  ──parse──▶  NuSMV-subset AST  ──build──▶  Kripke structure
                                                       │
                                                       ▼
                                            CTL fixed-point checker
                                                       │
                                                       ▼
                                  per-formula verdict + counterexample
                                                       │
                                                       ▼
                              formal-verification-report.json (signed)
```

* **Specs** live under
  `src/test-intelligence/formal-verification/specs/`. They are
  NuSMV-compatible text files (`*.smv`) — operators can re-run them in
  stock NuSMV for cross-validation.
* The **driver** is `scripts/run-formal-verification.mjs`. It is
  deterministic: identical specs plus a fixed `--generated-at`
  timestamp produce byte-identical reports.
* The **CI gate** is `G10_FORMAL_VERIFICATION_PASS`. Any formula that
  fails to verify fails CI.
* The dossier renderer surfaces a `"Formal Verification"` section
  driven by the optional `formalVerification` field on the audit
  dossier manifest.

## Spec format — a tiny NuSMV subset

We deliberately support a **small** subset of NuSMV so an auditor who
already knows NuSMV can read the specs without surprise, and so the
self-contained TypeScript driver remains tractable:

```text
MODULE main

VAR
  state_var : { value_a, value_b, value_c };   -- symbolic enum
  counter   : 0 .. 2;                          -- bounded integer
  flag      : boolean;                         -- boolean (FALSE/TRUE)

ASSIGN
  init(state_var) := value_a;
  init(counter)   := 0;
  init(flag)      := FALSE;

  next(state_var) := case
    state_var = value_a                     : value_b;
    state_var = value_b & counter < 2       : { value_b, value_c };
    state_var = value_b & counter >= 2      : value_c;
    state_var = value_c                     : value_c;
    TRUE                                    : state_var;
  esac;

  next(counter) := case
    state_var = value_b & counter < 2 : counter + 1;
    TRUE                              : counter;
  esac;

  next(flag) := case
    state_var = value_b : { TRUE, FALSE };  -- nondeterministic choice
    TRUE                : flag;
  esac;

-- Liveness: every run eventually settles in value_c.
LTLSPEC G F state_var = value_c

-- Safety: counter is bounded.
LTLSPEC G ( counter >= 0 & counter <= 2 )

-- CTL alternative for the liveness obligation above.
CTLSPEC AG AF state_var = value_c
```

Supported constructs:

| Construct           | Notation                            |
| ------------------- | ----------------------------------- |
| Enum variable       | `name : { v1, v2, ... };`           |
| Range variable      | `name : MIN .. MAX;`                |
| Boolean variable    | `name : boolean;`                   |
| Initial assignment  | `init(name) := <expr>;`             |
| Transition          | `next(name) := <expr>;`             |
| `case`/`esac`       | `case g1 : e1; g2 : e2; … esac`     |
| Set / nondeterminism| `{ v1, v2, ... }` (chooses one)     |
| Boolean             | `TRUE`, `FALSE`, `!`, `&`, `|`, `->`, `<->` |
| Comparisons         | `=`, `!=`, `<`, `<=`, `>`, `>=`     |
| Set membership      | `x in { v1, v2 }`                   |
| Arithmetic          | `+`, `-` (over integers)            |
| LTL operators       | `G`, `F`, `X`, `U`                  |
| CTL operators       | `EX`, `AX`, `EF`, `AF`, `EG`, `AG`, `E[ p U q ]`, `A[ p U q ]` |

Not supported (and intentionally rejected): `DEFINE`, multiple modules,
fairness constraints, reals. These are out of scope for the pilot. The
parser raises a clear error if they appear.

## Semantics under the hood

Specs are lifted to a finite-state **Kripke structure** by enumerating
the reachable valuations of every declared variable. From each
reachable state we apply the `next(...)` rules to compute the set of
successors. Sets `{ … }` introduce nondeterminism — each member is a
separate successor.

LTL formulae are translated to their universal-path CTL counterparts:

| LTL                | CTL                |
| ------------------ | ------------------ |
| `G φ`              | `AG φ`             |
| `F φ`              | `AF φ`             |
| `X φ`              | `AX φ`             |
| `p U q`            | `A[p U q]`         |

This is the **ACTL fragment** — it gives faithful branching-time
semantics for safety + liveness properties (`G`, `G(p → F q)`,
`G(p → X q)`). For properties where LTL and CTL diverge under
unfairness (e.g. an infinite stutter loop), you must encode the
necessary fairness in the model itself (the PSD2 pilot does exactly
this — the `factor_count` increments deterministically inside
`authenticating`).

CTL is then checked via the standard explicit-state fixed-point
algorithm:

* `EX φ` — state has a successor in `φ`.
* `EG φ` — greatest fixed-point over `φ` states.
* `EF φ` — backward BFS from `φ` states.
* `EU p q` — least fixed-point: `q ∨ (p ∧ EX EU)`.
* Universal-path operators derive from the existential ones:
  `AF φ ≡ ¬EG ¬φ`, `AG φ ≡ ¬EF ¬φ`,
  `AU p q ≡ ¬E[¬q U (¬p ∧ ¬q)] ∧ ¬EG ¬q`.

Counterexamples are minimal-by-BFS traces leading from an initial
state to a state that witnesses the failure. For AG-style safety
properties the witness is any reachable state where the proposition
fails.

## Pilot spec walkthrough — PSD2 SCA Article 97

> **Obligation** *(Directive (EU) 2015/2366 Art. 97, EBA RTS 2018/389
> Art. 4)*: a payment service provider must apply Strong Customer
> Authentication based on **two or more elements** before completing
> an electronic payment.

We model the workflow with two variables:

* `payment_state ∈ { idle, initiated, authenticating, authenticated, completed, refused }`
* `factor_count ∈ {0, 1, 2}` — how many factors have been gathered

Transitions encode the operational order:

1. `idle → idle | initiated` — user may initiate at any time.
2. `initiated → authenticating` — SCA gate enters (resets `factor_count` to 0).
3. `authenticating & factor_count < 2 → { authenticating, refused }` — gather
   another factor or abort.
4. `authenticating & factor_count >= 2 → authenticated`.
5. `authenticated → completed`.
6. `completed`, `refused` — absorbing.

The critical modelling decision: while in `authenticating` with
`factor_count < 2`, `factor_count` *increments* — there is no stutter.
That encodes the operational invariant "every authentication step
makes progress or aborts," and lets the universal-path CTL
translation accept the liveness property as written.

Three properties are verified:

* **P1 Liveness** — every initiated payment terminates:
  `G ( payment_state = initiated -> F ( payment_state = authenticated | payment_state = refused ) )`
* **P2 Safety (SCA gate)** — completed payments always had two factors:
  `G ( payment_state = completed -> factor_count >= 2 )`
* **P3 Safety (no fast-path)** — the system cannot jump from
  `initiated` to `completed`:
  `G ( payment_state = initiated -> X ( payment_state != completed ) )`

All three pass on the pilot model.

## Pilot spec walkthrough — MiFID II suitability Article 25(2)

> **Obligation** *(Directive 2014/65/EU Art. 25(2), CDR 2017/565
> Art. 54)*: when providing investment advice, the firm must obtain
> sufficient information to recommend suitable services; it **must
> not** recommend services without that information.

We model the advisory workflow with:

* `advice_state ∈ { entry, gathering, assessing, recommended, refused }`
* `info_complete : boolean` — TRUE iff the suitability questionnaire
  produced a complete profile

Transitions:

1. `entry → gathering`.
2. `gathering → { assessing, refused }` — client may refuse to answer.
3. `assessing & info_complete = TRUE → { recommended, refused }`.
4. `assessing & info_complete = FALSE → refused` (CDR Art. 54 hard
   stop).
5. `recommended`, `refused` — absorbing.

Three properties are verified:

* **P1 Liveness** — every session terminates:
  `G ( advice_state = entry -> F ( advice_state = recommended | advice_state = refused ) )`
* **P2 CDR Art. 54 enforcement** — recommendation requires complete
  information:
  `G ( advice_state = recommended -> info_complete = TRUE )`
* **P3 Workflow ordering** — recommendations cannot be issued in
  state `entry`:
  `G ( advice_state = entry -> X ( advice_state != recommended ) )`

All three pass on the pilot model.

## CI gate — `G10_FORMAL_VERIFICATION_PASS`

The driver exits non-zero on any failure. CI invokes it via:

```sh
node --import tsx scripts/run-formal-verification.mjs \
  --generated-at "$RUN_TIMESTAMP" \
  --output-dir "$RUN_DIR"
```

The orchestrator wraps the exit code as
`G10_FORMAL_VERIFICATION_PASS`. The
`FormalVerificationHardGateError` class is also exported so the
in-process runner can throw the same hard gate without shelling out.

## Reading the artifact

`formal-verification-report.json` is canonical JSON. The auditor-facing
fields:

```jsonc
{
  "schemaVersion": "1.0.0",
  "generatedAt": "<ISO-8601>",
  "specs": [
    {
      "specPath": "src/test-intelligence/formal-verification/specs/psd2-sca-art-97.smv",
      "specSha256": "<hex>",
      "module": "main",
      "reachableStateCount": 9,
      "formulae": [
        {
          "logic": "LTL",
          "formula": "G ((payment_state = initiated) -> F ((payment_state = authenticated) | (payment_state = refused)))",
          "verdict": "pass"
        },
        // ...
      ],
      "verdict": "pass"
    }
  ],
  "summary": {
    "specCount": 2,
    "formulaCount": 6,
    "passCount": 6,
    "failCount": 0,
    "verdict": "pass"
  }
}
```

When a formula fails, the per-formula entry carries a
`counterexample` field:

```jsonc
{
  "logic": "LTL",
  "formula": "G ( ... )",
  "verdict": "fail",
  "counterexample": {
    "trace": [
      { "id": "...", "valuation": { "payment_state": "initiated", "factor_count": 0 } },
      // ... shortest BFS path to a failing state
    ],
    "explanation": "formula does not hold; counterexample length 3; at state 2: ...; formula=..."
  }
}
```

## Reproducing locally

```sh
# Verify both pilot specs against the bundled model.
node --import tsx scripts/run-formal-verification.mjs

# Verify the smoke fixtures (one passing, one deliberately failing).
node --import tsx scripts/run-formal-verification.mjs \
  --specs-dir fixtures/formal-verification

# Pin generated-at for a byte-stable artifact (CI uses the run timestamp).
node --import tsx scripts/run-formal-verification.mjs \
  --generated-at 2026-05-10T00:00:00.000Z \
  --output-dir /tmp/fv
```

## Out of scope for the pilot

* Lifting the remaining EU compliance frameworks (DORA, IDD, Solvency
  II, EU AI Act, GDPR) — they continue as runtime rule packs only.
* Self-modifying rule packs — rules remain operator-curated.
* Fairness constraints, real numbers, parametric modules — vendor in
  NuSMV (or a richer model checker) before extending the spec format.
