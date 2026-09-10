import { CannotEvaluateError } from "../figma/profile.mjs";
export function componentError(message) {
  return new CannotEvaluateError("COMPONENT_EVIDENCE_INPUT", message);
}
export function evaluateComponentPolicies(config, evidence) {
  return Object.fromEntries(
    Object.entries(config.profiles).map(([id, profile]) => {
      const unmet = profile.requirements.filter(
        (key) => evidence[key]?.state !== "satisfied",
      );
      return [
        id,
        {
          requirements: [...profile.requirements],
          unmet,
          outcome: !profile.requirements.length
            ? "not-applicable"
            : unmet.length
              ? "unsatisfied"
              : "satisfied",
          consumers: { ...profile.consumers },
        },
      ];
    }),
  );
}
export function evaluateComponentPromotion(
  report,
  config,
  { profile, consumer },
) {
  if (
    !Object.hasOwn(config.profiles, profile) ||
    !Object.hasOwn(config.profiles[profile].consumers, consumer)
  )
    throw componentError(
      "Select an explicitly configured profile and consumer",
    );
  const selected = config.profiles[profile],
    enforcement = selected.consumers[consumer];
  // Recompute from current evidence, never trust a supplied decision or highest-claim label.
  const decision = evaluateComponentPolicies(config, report.evidence)[profile];
  const failed = decision.unmet.length > 0;
  return {
    profile,
    consumer,
    enforcement,
    requirements: decision.requirements,
    unmet: decision.unmet,
    outcome:
      decision.outcome === "not-applicable"
        ? "not-applicable"
        : failed
          ? enforcement === "blocking"
            ? "block"
            : "advisory"
          : "pass",
    ok: !(failed && enforcement === "blocking"),
    requirementsSatisfied: !failed,
  };
}
