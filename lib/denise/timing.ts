// How long each step of a request to Denise took, logged as one line
// (`[denise] timing {...}`) when it's done, so a slow answer can be traced
// in the server's logs: the action, step names and milliseconds, and
// whether this server had just started (`cold`, the first request it
// served). Never the question, an answer or client data.

let served = 0;

export type StepTimer = { mark: (step: string) => void; log: (outcome: string) => void };

export function stepTimer(action: string, now: () => number = () => performance.now()): StepTimer {
  const start = now();
  const cold = served++ === 0;
  const steps: [string, number][] = [];
  const since = () => Math.round(now() - start);
  return {
    mark: (step) => {
      steps.push([step, since()]);
    },
    log: (outcome) => {
      console.info(`[denise] timing ${JSON.stringify({ action, outcome, ms: since(), cold, steps })}`);
    },
  };
}
