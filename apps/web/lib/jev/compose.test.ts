// @vitest-environment node
import { describe, expect, it } from "vitest";
import { composeUI, type CompositionEvent, type Evaluate } from "./compose";
import { buildCandidates, MAX_ELEMENTS } from "./grammar";

function scripted(
  choices: { next: string; parent?: string }[],
  usage: number | undefined = 100,
): Evaluate {
  let index = 0;
  return async ({ questions }) => {
    const selected = choices[index++];
    if (!selected) throw new Error("Unexpected extra model call");
    const answers = Object.fromEntries(
      Object.keys(questions).map((name) => [
        name,
        {
          confidence: 0.9,
          choice: selected[name as keyof typeof selected]!,
        },
      ]),
    );
    return {
      answers,
      usage: { inputTokens: usage },
    };
  };
}

async function collect(
  evaluate: Evaluate,
  signal = new AbortController().signal,
) {
  const events: CompositionEvent[] = [];
  for await (const event of composeUI(
    'Create settings titled "Preferences".',
    signal,
    evaluate,
  ))
    events.push(event);
  return events;
}

describe("Jev catalog composition", () => {
  it("composes a new nested tree with state bindings and catalog actions", async () => {
    const events = await collect(
      scripted([
        { next: "card" },
        { next: "input_email" },
        { next: "stack_horizontal" },
        { next: "save", parent: "node_2" },
        { next: "reset", parent: "node_2" },
        { next: "status", parent: "node_0" },
        { next: "finish", parent: "node_0" },
      ]),
    );
    const result = events.at(-1)!;
    expect(result.type).toBe("complete");
    if (result.type !== "complete") throw new Error("Missing final result");
    expect(result.stopReason).toBe("finish");
    expect(result.spec?.elements.node_0?.children).toEqual([
      "node_1",
      "node_2",
      "node_5",
    ]);
    expect(result.spec?.elements.node_2?.children).toEqual([
      "node_3",
      "node_4",
    ]);
    expect(result.spec?.elements.node_1?.props.value).toEqual({
      $bindState: "/form/email",
    });
    expect(result.spec?.elements.node_3?.on?.press).toEqual({
      action: "setState",
      params: { statePath: "/status", value: "Changes saved locally." },
    });
    expect(result.inputTokens).toBe(700);
    // Streamed snapshots stay immutable as later elements are appended.
    const first = events[0]!;
    expect(first.type === "step" && Object.keys(first.spec.elements)).toEqual([
      "node_0",
    ]);
  });

  it("cannot accept an arbitrary component, path, or nonexistent parent from the model", async () => {
    await expect(
      collect(scripted([{ next: "execute_shell" }])),
    ).rejects.toThrow("outside the permitted");
    await expect(
      collect(
        scripted([
          { next: "card" },
          { next: "stack_horizontal" },
          { next: "save", parent: "/secrets" },
        ]),
      ),
    ).rejects.toThrow("outside the permitted");
  });

  it("supplies literal quoted text as a value, never as executable structure", () => {
    const text = "<script>alert(1)</script>";
    const candidates = buildCandidates(`Title the UI "${text}".`);
    expect(
      candidates.find((c) => c.element.props.text === text)?.element.type,
    ).toBe("Heading");
  });

  it("reports unavailable capability without producing a misleading empty UI", async () => {
    const events = await collect(scripted([{ next: "unavailable" }]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "complete",
      spec: null,
      stopReason: "unavailable",
    });
  });

  it("preserves unknown usage and stops at the configured call budget", async () => {
    const events = await collect(
      scripted([{ next: "card" }, { next: "finish" }], undefined),
    );
    // Explicitly remove usage to exercise the missing-usage path.
    const missingUsage: Evaluate = async (request) => {
      const result = await scripted([{ next: "unavailable" }])(request);
      return { ...result, usage: undefined };
    };
    expect((await collect(missingUsage)).at(-1)).toMatchObject({
      inputTokens: null,
      estimatedCostUsd: null,
    });
    expect(events.at(-1)?.type).toBe("complete");
    const choices = [
      { next: "card" },
      ...Array.from({ length: MAX_ELEMENTS - 1 }, () => ({
        next: "separator",
      })),
    ];
    const limited = (await collect(scripted(choices))).at(-1);
    expect(limited).toMatchObject({ type: "complete", stopReason: "limit" });
    if (limited?.type === "complete")
      expect(Object.keys(limited.spec!.elements)).toHaveLength(MAX_ELEMENTS);
  });

  it("honors cancellation before making another provider request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collect(scripted([]), controller.signal)).rejects.toThrow();
  });
});
