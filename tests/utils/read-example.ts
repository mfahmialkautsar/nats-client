import { readFileSync } from "node:fs";
import { join } from "node:path";

const EXAMPLES_DIR = join(process.cwd(), "examples");

export function readExampleFile(filename: string): string {
  return readFileSync(join(EXAMPLES_DIR, filename), "utf-8");
}

export const EXAMPLES = {
  PUB_SUB: readExampleFile("pub-sub.nats"),
  REQUEST_REPLY: readExampleFile("request-reply.nats"),
  JETSTREAM: readExampleFile("jetstream.nats"),
};
