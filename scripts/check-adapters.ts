/**
 * The pricing, retry and error rules every LLM adapter shares.
 *
 * A `.ts` file, not `.mts`: tsx loads a second copy of a module for the .mts
 * graph, and `instanceof RetryableError` is then false across that seam, which
 * makes the retry rules look broken when they are not.
 */
import {
  attemptClassify,
  classifyResult,
  throwForStatus,
  MalformedOutputError,
  type Rates,
} from "@/lib/llm/types";
import { RetryableError } from "@/lib/retry";

async function main() {
  const results: [string, boolean][] = [];
  const expect = (label: string, condition: boolean) => results.push([label, condition]);

  const valid = JSON.stringify({
    is_application_related: true, company_name: "Acme", status: "APPLIED",
    is_significant: true, email_title: "Hi", confidence_score: 0.5, summary: "s",
  });

  // --- cost math, against the literal old formulas -------------------------
  const cases: [string, Rates, number, number][] = [
    ["anthropic", { inputPerMTok: 1.0, outputPerMTok: 5.0 }, 1234, 567],
    ["gemini", { inputPerMTok: 0.75, outputPerMTok: 3.75 }, 98765, 4321],
    ["openrouter", { inputPerMTok: 0.375, outputPerMTok: 1.875 }, 5000, 250],
  ];
  for (const [name, rates, i, o] of cases) {
    const old = (i / 1_000_000) * rates.inputPerMTok + (o / 1_000_000) * rates.outputPerMTok;
    const got = classifyResult({ model: "m", rates, raw: valid, inputTokens: i, outputTokens: o }).usage;
    expect(`${name}: cost matches the old sum`, got.costUsd === old);
    expect(`${name}: tokens carried through`, got.inputTokens === i && got.outputTokens === o);
  }

  // --- OpenRouter reported cost wins, exactly as `typeof x === "number"` did
  const or: Rates = { inputPerMTok: 0.375, outputPerMTok: 1.875 };
  const summed = (5000 / 1_000_000) * 0.375 + (250 / 1_000_000) * 1.875;
  const withCost = (reported: number | null | undefined) =>
    classifyResult({ model: "m", rates: or, raw: valid, inputTokens: 5000, outputTokens: 250, reportedCostUsd: reported }).usage.costUsd;
  expect("reported cost is used", withCost(0.004) === 0.004);
  expect("a reported zero is still used", withCost(0) === 0);
  expect("undefined falls back to the sum", withCost(undefined) === summed);
  expect("null falls back to the sum", withCost(null) === summed);

  // --- throwForStatus ------------------------------------------------------
  const res = (status: number, body: string) => new Response(body, { status });
  try {
    await throwForStatus("Gemini", res(503, "upstream down"));
    expect("503 throws", false);
  } catch (e) {
    expect("503 is retryable", e instanceof RetryableError);
    expect("503 message is unchanged", (e as Error).message === "Gemini 503: upstream down");
    expect("503 carries its status", (e as RetryableError).status === 503);
  }
  try {
    await throwForStatus("OpenRouter", res(400, "bad request"));
    expect("400 throws", false);
  } catch (e) {
    expect("400 is not retryable", e instanceof Error && !(e instanceof RetryableError));
    expect("400 message is unchanged", (e as Error).message === "OpenRouter 400: bad request");
  }

  // --- attemptClassify: retry, then one larger cap -------------------------
  const caps: number[] = [];
  let calls = 0;
  const out = await attemptClassify(1024, async (maxTokens) => {
    caps.push(maxTokens);
    calls += 1;
    if (calls === 1) throw new MalformedOutputError("{oops", "cut off");
    return classifyResult({ model: "m", rates: or, raw: valid, inputTokens: 1, outputTokens: 1 });
  });
  expect("a malformed answer is retried once with four times the cap", caps.join(",") === "1024,4096");
  expect("the second attempt's result is returned", out.classification.companyName === "Acme");

  const capsB: number[] = [];
  let tries = 0;
  const outB = await attemptClassify(2048, async (maxTokens) => {
    capsB.push(maxTokens);
    tries += 1;
    if (tries < 3) throw new RetryableError("429 slow down", 429);
    return classifyResult({ model: "m", rates: or, raw: valid, inputTokens: 1, outputTokens: 1 });
  });
  expect("transport errors retry at the same cap", capsB.join(",") === "2048,2048,2048");
  expect("the retried call returns its result", outB.usage.model === "m");

  let malformedTries = 0;
  try {
    await attemptClassify(512, async () => {
      malformedTries += 1;
      throw new MalformedOutputError("{still bad", "cut off");
    });
    expect("a twice malformed answer still throws", false);
  } catch (e) {
    expect("a twice malformed answer still throws", e instanceof MalformedOutputError);
    expect("and it is not tried a third time", malformedTries === 2);
  }

  for (const [label, ok] of results) console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);

}

main();
