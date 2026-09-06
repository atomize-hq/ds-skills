/**
 * Exit codes are part of the CLI's interface, not an implementation detail.
 *
 * The line that matters is 1 versus 2. `NONCONFORMANT` is an *answer*: the
 * command evaluated its inputs and they do not conform. `CANNOT_EVALUATE` is
 * the absence of one. A caller that cannot tell those apart will eventually
 * report a missing tool as a clean bill of health — which is exactly what the
 * consumer's status rail does today.
 *
 * See docs/ds-skills-boundary-contract.md §3.1 in the consumer repo.
 */
export const EXIT_OK = 0;
export const EXIT_NONCONFORMANT = 1;
export const EXIT_CANNOT_EVALUATE = 2;
export const EXIT_UNEXPECTED = 3;

/**
 * Codes 2 and 3 emit nothing on stdout, deliberately: a caller parsing stdout
 * must not be able to mistake a non-answer for an empty result.
 */
export function emitsMachineResult(exitCode: number): boolean {
  return exitCode === EXIT_OK || exitCode === EXIT_NONCONFORMANT;
}
