# Base transaction investigation

Language for the proposed investigator. Principal, agent, credit, and claim retain
their definitions in the private-credit glossary.

## Language

**Investigation**:
A bounded task that explains a failed Base transaction using execution evidence.
_Avoid_: chat request, paid prompt

**Execution evidence**:
Transaction facts used to support a diagnosis, such as a receipt, event logs,
revert data, or an execution trace.

**Investigation report**:
The result of an investigation, connecting its explanation and suggested next
steps to supporting execution evidence and identifying unresolved uncertainty.

**Execution-data purchase**:
A purchase of additional execution evidence for an investigation. It is distinct
from consuming a prepaid inference credit.

**Investigation purchase budget**:
The principal's ceiling on execution-data purchases for one investigation,
denominated separately from its inference allocation. An unresolved purchase
holds budget until its charge outcome is reconciled.

**Investigation inference allocation**:
The maximum prepaid credit slots made available to one investigation. A retired
slot counts against this allocation even when no credit consumption is confirmed.

**Confirmed inference consumption**:
The committed credits used by an investigation. It is distinct from its allocation
and from slots retired locally without a confirmed commit.

**Partial investigation report**:
An investigation report that identifies missing evidence or unresolved outcomes
alongside supported findings and the reason the investigation stopped.

**Observed fact**:
A statement about the investigated transaction directly established by cited
execution evidence.

**Supported diagnosis**:
An explanation of the transaction's failure supported by cited execution
evidence, limited to what that evidence establishes.

**LLM hypothesis**:
A possible explanation proposed by inference that the available execution
evidence does not establish. It identifies the missing evidence and a check
that could distinguish it from other explanations.

**Insufficient evidence**:
An investigation outcome in which the available execution evidence cannot
support a diagnosis, although observed facts may still be reported.

**Investigation runtime owner**:
The exclusive local operator of a dedicated inference credential for investigations.
The credential is not simultaneously used by another runtime or device.

**Evidence summary**:
A bounded selection of validated execution evidence, with references and explicit
omissions, used to support interpretation without changing what the evidence proves.

**Outcome reconciliation**:
Determining the outcome of an existing attempt without authorizing a replacement.
Confirmed settlement and validated evidence delivery remain distinct outcomes.
