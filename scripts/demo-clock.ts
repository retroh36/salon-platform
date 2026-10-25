// Runs this process's clock MAESTRA_DEMO_OFFSET_MS milliseconds from the
// real one (still ticking), for the marketing screenshots: the app server
// and the insights script load it with `--import`, so they agree with the
// demo seed's "now" (scripts/screenshots.ts). Without the variable it does
// nothing.

const offset = Number(process.env.MAESTRA_DEMO_OFFSET_MS ?? 0);

if (offset) {
  const RealDate = Date;
  const shifted = () => RealDate.now() + offset;
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args) => (args.length ? new target(...(args as ConstructorParameters<DateConstructor>)) : new target(shifted())),
    apply: () => new RealDate(shifted()).toString(),
    get: (target, key, receiver) => (key === "now" ? shifted : Reflect.get(target, key, receiver)),
  });
}
