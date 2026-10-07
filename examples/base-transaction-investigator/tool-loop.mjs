const plainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
/** Model requests carry no authority; operations and destinations belong to the owner. */
export function createToolLoop({ report, clock, started, operations = {} }) {
  const definitions = Object.keys(operations).map((name) => ({
    type: "function",
    function: {
      name,
      description:
        name === "clarify"
          ? "Ask one bounded human clarification."
          : "Read configured evidence for this transaction only.",
      parameters: {
        type: "object",
        properties:
          name === "clarify"
            ? { question: { type: "string", maxLength: 2048 } }
            : {},
        required: name === "clarify" ? ["question"] : [],
        additionalProperties: false,
      },
    },
  }));
  return {
    definitions,
    async dispatch(calls, { reportingOnly = false } = {}) {
      const results = [];
      for (const call of Array.isArray(calls) ? calls : [calls]) {
        if (clock() - started >= 120000) throw Error("deadline_exceeded");
        if (
          reportingOnly ||
          report.toolInvocations >= (call?.function?.name === "clarify" ? 5 : 6)
        ) {
          if (
            !report.validationFailures.includes(
              "model_tool_reserve_unavailable",
            )
          )
            report.validationFailures.push("model_tool_reserve_unavailable");
          break;
        }
        report.toolInvocations++;
        const name = call?.function?.name;
        let error;
        if (!Object.hasOwn(operations, name ?? ""))
          error = "unknown_model_tool";
        let args;
        if (!error) {
          const fn = call.function;
          try {
            if (
              !plainObject(call) ||
              call.type !== "function" ||
              typeof call.id !== "string" ||
              !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) ||
              Object.keys(call).some(
                (k) => !["id", "type", "function"].includes(k),
              ) ||
              !plainObject(fn) ||
              Object.keys(fn).some((k) => !["name", "arguments"].includes(k)) ||
              typeof fn.arguments !== "string" ||
              Buffer.byteLength(fn.arguments) > 2048
            )
              throw Error();
            args = JSON.parse(fn.arguments);
            if (
              !plainObject(args) ||
              (name === "clarify"
                ? Object.keys(args).length !== 1 ||
                  typeof args.question !== "string" ||
                  !args.question.trim() ||
                  Buffer.byteLength(args.question) > 2048
                : Object.keys(args).length !== 0)
            )
              throw Error();
          } catch {
            error = "invalid_model_tool";
          }
        }
        if (error) {
          report.validationFailures.push(error);
          results.push({ status: error });
          continue;
        }
        try {
          const value = await operations[name](args);
          results.push({
            operation: name,
            status: "completed",
            ...(value === undefined ? {} : { value }),
          });
        } catch (e) {
          if (
            [
              "deadline_exceeded",
              "local_persistence_failed",
              "reorganization",
              "canonical_revalidation_unavailable",
            ].includes(e.message)
          )
            throw e;
          const reason = [
            "clarification_limit",
            "invalid_clarification",
            "tool_limit",
          ].includes(e.message)
            ? e.message
            : "model_tool_evidence_unavailable";
          report.validationFailures.push(reason);
          results.push({ operation: name, status: reason });
        }
      }
      return results;
    },
  };
}
