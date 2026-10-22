// Runs before each database test file: they expect the busy demo month on
// top of the default seed (which has a clear calendar).
import { beforeAll } from "vitest";
import { requireDemoData } from "./helpers";

beforeAll(requireDemoData);
