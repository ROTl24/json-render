// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  defineCatalog,
  defineSchema,
  experimental_composeSpec,
  type Experimental_ComposeSpecOptions,
  type Experimental_CompositionCandidate,
  type Experimental_CompositionEvaluator,
  type Experimental_CompositionEvaluation,
  type Experimental_CompositionEvent,
  type Spec,
} from "./index";

// Deliberately unrelated to the web playground's catalog.
const schema = defineSchema(
  (s) => ({
    spec: s.object({
      root: s.string(),
      elements: s.record(
        s.object({
          type: s.ref("catalog.components"),
          props: s.propsOf("catalog.components"),
          children: s.array(s.string()),
          slots: { ...s.record(s.array(s.string())), ...s.optional() },
        }),
      ),
    }),
    catalog: s.object({
      components: s.map({
        props: s.zod(),
        slots: s.array(s.string()),
        events: s.array(s.string()),
      }),
      actions: s.map({ params: s.zod() }),
    }),
  }),
  { builtInActions: [{ name: "setState", description: "Update local state" }] },
);
const catalog = defineCatalog(schema, {
  components: {
    Panel: { props: z.object({}), slots: ["default", "footer"] },
    Readout: { props: z.object({ value: z.number() }), slots: [] },
    Trigger: { props: z.object({ label: z.string() }), events: ["activate"] },
  },
  actions: { inspect: { params: z.object({ reading: z.number() }) } },
});
const candidates: Experimental_CompositionCandidate[] = [
  {
    id: "panel",
    description: "A telemetry panel",
    element: { type: "Panel", props: {} },
    maxUses: 5,
  },
  {
    id: "temperature",
    description: "Temperature readout",
    resource: "reading",
    root: false,
    element: { type: "Readout", props: { value: { $state: "/temperature" } } },
  },
  {
    id: "alternate",
    description: "Alternate readout",
    resource: "reading",
    root: false,
    element: { type: "Readout", props: { value: 20 } },
  },
  {
    id: "inspect",
    description: "Inspect the reading",
    root: false,
    element: {
      type: "Trigger",
      props: { label: "Inspect" },
      on: {
        activate: {
          action: "inspect",
          params: { reading: { $state: "/temperature" } },
        },
      },
    },
  },
];
const options = {
  catalog,
  candidates,
  prompt: "Build a telemetry panel",
  initialState: { temperature: 20, privateToken: "not-for-the-model" },
};
function scripted(
  choices: [string, string?][],
): Experimental_CompositionEvaluator {
  let index = 0;
  return vi.fn(async ({ questions }) => {
    const [next, parent] = choices[index++] ?? [];
    return {
      answers: {
        next: { choice: next! },
        ...(questions.parent ? { parent: { choice: parent ?? "node_0" } } : {}),
      },
      usage: { inputTokens: 10 },
    };
  });
}
async function collect(
  overrides: Partial<Experimental_ComposeSpecOptions> = {},
) {
  return collectEvents(
    experimental_composeSpec({
      ...options,
      evaluate: scripted([
        ["panel"],
        ["temperature"],
        ["inspect", "node_0:footer"],
        ["finish"],
      ]),
      ...overrides,
    }),
  );
}

async function collectEvents(
  events: AsyncIterable<Experimental_CompositionEvent>,
) {
  const result: Experimental_CompositionEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe("experimental_composeSpec", () => {
  async function seed() {
    return (await collect()).at(-1)!.spec!;
  }

  it("edits a selected spec without mutating it, preserving IDs, state, bindings and named slots", async () => {
    const initialSpec = await seed();
    const original = structuredClone(initialSpec);
    const events = await collect({
      initialSpec,
      evaluate: scripted([
        ["replace:node_1"],
        ["alternate"],
        ["remove:node_2"],
        ["inspect", "node_0:footer"],
        ["finish"],
      ]),
    });
    const result = events.at(-1)!.spec!;
    expect(initialSpec).toEqual(original);
    expect(result.elements.node_1!.props).toEqual({ value: 20 });
    expect(result.root).toBe(initialSpec.root);
    expect(result.state).toEqual(initialSpec.state);
    expect(result.elements.node_0!.children).toEqual(["node_1"]);
    const actionId = result.elements.node_0!.slots!.footer![0]!;
    expect(result.elements[actionId]!.on).toEqual(
      initialSpec.elements.node_2!.on,
    );
    expect(events[0]!.spec).toEqual(initialSpec);
  });

  it("moves subtrees between named slots and reorders without dropping descendants", async () => {
    const initialSpec = await seed();
    const choices = [
      "panel",
      "move:node_1",
      "into nested",
      "move:node_3",
      "before readout",
      "finish",
    ];
    const evaluate: Experimental_CompositionEvaluator = async ({
      questions,
    }): Promise<Experimental_CompositionEvaluation> => {
      let choice = choices.shift()!;
      if (choice === "into nested")
        choice = Object.entries(questions.next!.criteria).find(
          ([, description]) =>
            description.includes("into node_3") &&
            description.includes("slot footer"),
        )![0];
      if (choice === "before readout")
        choice = Object.entries(questions.next!.criteria).find(
          ([, description]) =>
            description.includes("into node_0") &&
            description.includes("before node_2"),
        )![0];
      return {
        answers: {
          next: { choice },
          ...(questions.parent ? { parent: { choice: "node_0" } } : {}),
        },
      };
    };
    const result = (await collect({ initialSpec, evaluate })).at(-1)!.spec!;
    expect(result.elements.node_3!.slots!.footer).toEqual(["node_1"]);
    expect(result.elements.node_0!.children).toEqual([]);
    expect(result.elements.node_0!.slots!.footer).toEqual(["node_3", "node_2"]);
  });

  it("does not offer cyclic, over-depth, no-op moves or replacements that lose children", async () => {
    const initialSpec = (
      await collect({
        evaluate: scripted([
          ["panel"],
          ["panel"],
          ["temperature", "node_1"],
          ["panel", "node_0"],
          ["finish"],
        ]),
      })
    ).at(-1)!.spec!;
    let call = 0;
    const evaluate: Experimental_CompositionEvaluator = async ({
      questions,
    }): Promise<Experimental_CompositionEvaluation> => {
      call++;
      if (call === 1)
        return {
          answers: {
            next: { choice: "replace:node_0" },
            parent: { choice: "node_0" },
          },
        };
      expect(questions.next!.criteria).not.toHaveProperty("alternate");
      expect(questions.next!.criteria).not.toHaveProperty("temperature");
      return { answers: { next: { choice: "unavailable" } } };
    };
    // A replacement option is offered only when it differs and retains every occupied slot.
    const moreCandidates = [
      ...candidates,
      {
        id: "secondPanel",
        description: "Alternate panel",
        element: { type: "Panel", props: {}, visible: false },
      },
    ];
    await collect({
      initialSpec,
      candidates: moreCandidates,
      evaluate,
      maxDepth: 3,
    });
    const moves: Experimental_CompositionEvaluator = async ({
      questions,
    }): Promise<Experimental_CompositionEvaluation> => {
      if (Object.hasOwn(questions.next!.criteria, "move:node_1"))
        return {
          answers: {
            next: { choice: "move:node_1" },
            parent: { choice: "node_0" },
          },
        };
      for (const description of Object.values(questions.next!.criteria)) {
        expect(description).not.toContain("into node_1");
        expect(description).not.toContain("into node_2");
        expect(description).not.toContain("into node_3");
      }
      return { answers: { next: { choice: "unavailable" } } };
    };
    await collect({ initialSpec, evaluate: moves, maxDepth: 3 });
  });

  it("counts existing recipes against usage/resource limits and releases removed subtrees", async () => {
    const initialSpec = await seed();
    let call = 0;
    await collect({
      initialSpec,
      evaluate: async ({ questions }) => {
        if (call++ === 0) {
          expect(questions.next!.criteria).not.toHaveProperty("temperature");
          expect(questions.next!.criteria).not.toHaveProperty("alternate");
          return {
            answers: {
              next: { choice: "remove:node_1" },
              parent: { choice: "node_0" },
            },
          };
        }
        expect(questions.next!.criteria).toHaveProperty("temperature");
        expect(questions.next!.criteria).toHaveProperty("alternate");
        return {
          answers: { next: { choice: "finish" }, parent: { choice: "node_0" } },
        };
      },
    });
  });

  it("removes entire subtrees and restores their candidate availability", async () => {
    const initialSpec = (
      await collect({
        evaluate: scripted([
          ["panel"],
          ["panel"],
          ["temperature", "node_1"],
          ["finish"],
        ]),
      })
    ).at(-1)!.spec!;
    const result = (
      await collect({
        initialSpec,
        evaluate: scripted([["remove:node_1"], ["temperature"], ["finish"]]),
      })
    ).at(-1)!.spec!;
    expect(Object.keys(result.elements)).toHaveLength(2);
    expect(
      Object.values(result.elements).filter(
        (element) => element.type === "Readout",
      ),
    ).toHaveLength(1);
    expect(result.elements.node_0!.children).toHaveLength(1);
    expect(Object.keys(initialSpec.elements)).toHaveLength(3);
  });

  it("uses explicit descriptions without sharing seed props or state, and keeps no-op/limited edits intact", async () => {
    const initialSpec = await seed();
    initialSpec.elements.node_2!.props.label = "private label";
    initialSpec.state!.temperature = 22;
    const result = (
      await collect({
        initialSpec,
        initialState: undefined,
        elementDescriptions: { node_2: "Existing inspect action" },
        evaluate: async (request) => {
          expect(JSON.stringify(request)).not.toContain("private label");
          expect(JSON.stringify(request)).not.toContain("not-for-the-model");
          expect(JSON.stringify(request)).toContain("Existing inspect action");
          return scripted([["finish"]])(request);
        },
      })
    ).at(-1)!;
    expect(result.spec).toEqual(initialSpec);
    const limited = (
      await collect({
        initialSpec,
        maxSteps: 1,
        evaluate: scripted([["replace:node_1"]]),
      })
    ).at(-1)!;
    expect(limited).toMatchObject({ stopReason: "limit" });
    expect(limited.spec!.elements.node_1).toEqual(initialSpec.elements.node_1);
  });

  it.each([
    "cycle",
    "shared",
    "missing",
    "orphan",
    "unknown slot",
    "depth",
    "action",
    "repeat",
  ])("rejects an invalid seed before evaluation: %s", async (invalid) => {
    const initialSpec = await seed();
    if (invalid === "cycle")
      initialSpec.elements.node_0!.children!.push("node_0");
    if (invalid === "shared")
      initialSpec.elements.node_0!.children!.push("node_2");
    if (invalid === "missing")
      initialSpec.elements.node_0!.children!.push("missing");
    if (invalid === "orphan")
      initialSpec.elements.orphan = { type: "Panel", props: {} };
    if (invalid === "unknown slot")
      initialSpec.elements.node_0!.slots!.missing = ["node_1"];
    if (invalid === "action")
      initialSpec.elements.node_2!.on = { activate: { action: "deleteAll" } };
    if (invalid === "repeat")
      initialSpec.elements.node_0!.repeat = { statePath: "/rows" };
    const evaluate = scripted([]);
    await expect(
      collect({
        initialSpec,
        evaluate,
        ...(invalid === "depth" ? { maxDepth: 1 } : {}),
      }),
    ).rejects.toThrow();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects invalid selected edit destinations without mutating the seed", async () => {
    const initialSpec: Spec = await seed();
    const before = structuredClone(initialSpec);
    await expect(
      collect({
        initialSpec,
        evaluate: scripted([["move:node_1"], ["position:999"]]),
      }),
    ).rejects.toThrow("outside the permitted");
    expect(initialSpec).toEqual(before);
  });

  it("supports object-valued built-in actions and catalog action callbacks", async () => {
    const recipes = structuredClone(candidates);
    recipes[3]!.element.on = {
      activate: {
        action: "setState",
        params: { statePath: "/readings", value: [{ temperature: 20 }] },
        onSuccess: {
          action: "inspect",
          params: { reading: { $state: "/temperature" } },
        },
      },
    };
    recipes[3]!.element.visible = { $state: "/temperature", gt: 0 };
    const result = (await collect({ candidates: recipes })).at(-1);
    expect(result?.spec?.elements.node_2?.on).toEqual(recipes[3]!.element.on);
    expect(result?.spec?.elements.node_2?.visible).toEqual(
      recipes[3]!.element.visible,
    );
  });

  it("builds a custom catalog's named slots, bindings and actions", async () => {
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      stopReason: "finish",
      inputTokens: 40,
      spec: {
        root: "node_0",
        elements: {
          node_0: { children: ["node_1"], slots: { footer: ["node_2"] } },
          node_1: { props: { value: { $state: "/temperature" } } },
          node_2: {
            on: {
              activate: {
                action: "inspect",
                params: { reading: { $state: "/temperature" } },
              },
            },
          },
        },
      },
    });
    expect(events[0]?.spec?.elements.node_0?.children).toEqual([]);
  });

  it("enforces root eligibility, usage counts, resource exclusions and depth", async () => {
    const evaluate = scripted([
      ["panel"],
      ["temperature"],
      ["inspect"],
      ["finish"],
    ]);
    const observe: Experimental_CompositionEvaluator = async (request) => {
      const criteria = request.questions.next!.criteria;
      const built = request.state.already_built as unknown[];
      if (!built.length) expect(criteria).not.toHaveProperty("temperature");
      if (built.length >= 2) {
        expect(criteria).not.toHaveProperty("temperature");
        expect(criteria).not.toHaveProperty("alternate");
      }
      if (built.length >= 3) expect(criteria).not.toHaveProperty("inspect");
      return evaluate(request);
    };
    await collect({ evaluate: observe });
    await expect(
      collect({
        maxDepth: 1,
        evaluate: scripted([["panel"], ["temperature"]]),
      }),
    ).rejects.toThrow("outside the permitted");
    await expect(
      collect({ evaluate: scripted([["temperature"]]) }),
    ).rejects.toThrow("outside the permitted");
  });

  it("rejects arbitrary decisions, nonexistent parents and missing answers", async () => {
    await expect(
      collect({ evaluate: scripted([["execute_code"]]) }),
    ).rejects.toThrow("outside the permitted");
    await expect(
      collect({ evaluate: scripted([["panel"], ["inspect", "/secrets"]]) }),
    ).rejects.toThrow("outside the permitted");
    await expect(
      collect({ evaluate: async () => ({ answers: {} }) }),
    ).rejects.toThrow("outside the permitted");
  });

  it.each([
    { id: "finish" },
    { id: "panel" },
    { maxUses: 0 },
    { element: { type: "Missing", props: {} } },
    { element: { type: "Readout", props: { value: "wrong" } } },
    {
      element: { type: "Readout", props: { value: { $computed: "unknown" } } },
    },
    {
      element: { type: "Readout", props: { value: 1 }, children: ["outside"] },
    },
    {
      element: {
        type: "Trigger",
        props: { label: "go" },
        on: { press: { action: "inspect" } },
      },
    },
    {
      element: {
        type: "Trigger",
        props: { label: "go" },
        on: { activate: { action: "deleteAll" } },
      },
    },
    {
      element: {
        type: "Trigger",
        props: { label: "go" },
        on: { activate: { action: "inspect", params: { reading: "wrong" } } },
      },
    },
    {
      element: {
        type: "Trigger",
        props: { label: "go" },
        on: {
          activate: {
            action: "inspect",
            params: { reading: 1 },
            onSuccess: { action: "deleteAll" },
          },
        },
      },
    },
  ])(
    "rejects invalid recipes before calling the evaluator: %j",
    async (override) => {
      const evaluate = scripted([]);
      await expect(
        collect({
          candidates: [
            candidates[0]!,
            {
              ...candidates[1]!,
              ...override,
            } as Experimental_CompositionCandidate,
          ],
          evaluate,
        }),
      ).rejects.toThrow();
      expect(evaluate).not.toHaveBeenCalled();
    },
  );

  it("preserves unavailable and budget stops without inventing a complete UI", async () => {
    expect(
      (await collect({ evaluate: scripted([["unavailable"]]) })).at(-1),
    ).toMatchObject({ spec: null, stopReason: "unavailable" });
    expect(
      (await collect({ evaluate: scripted([["panel"], ["unavailable"]]) })).at(
        -1,
      ),
    ).toMatchObject({ spec: { root: "node_0" }, stopReason: "unavailable" });
    const evaluate = scripted([["panel"]]);
    expect((await collect({ evaluate, maxSteps: 1 })).at(-1)).toMatchObject({
      stopReason: "limit",
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
    await expect(collect({ maxSteps: Infinity })).rejects.toThrow(
      "positive safe integer",
    );
  });

  it("does not share state values, and isolates evaluator and consumer mutations", async () => {
    const localCandidates = structuredClone(candidates);
    const evaluate = scripted([["panel"], ["temperature"], ["finish"]]);
    const observe: Experimental_CompositionEvaluator = async (request) => {
      expect(JSON.stringify(request)).not.toContain("not-for-the-model");
      const built = request.state.already_built as { children: string[] }[];
      built[0]?.children.push("injected");
      request.questions.next!.criteria.injected = "not authorized";
      return evaluate(request);
    };
    const iterator = experimental_composeSpec({
      ...options,
      candidates: localCandidates,
      evaluate: observe,
    });
    const first = await iterator.next();
    first.value!.spec!.elements.node_0!.children!.push("consumer-mutation");
    localCandidates[1]!.element.type = "Changed";
    const rest = await collectEvents(iterator);
    expect(rest.at(-1)?.spec?.elements.node_0?.children).toEqual(["node_1"]);
    await expect(
      collect({
        evaluate: async (request) => {
          request.questions.next!.criteria.injected = "no";
          return { answers: { next: { choice: "injected" } } };
        },
      }),
    ).rejects.toThrow("outside the permitted");
  });

  it("preserves unknown usage and confidence, and rejects invalid telemetry", async () => {
    expect(
      (
        await collect({
          evaluate: async () => ({
            answers: { next: { choice: "unavailable" } },
          }),
        })
      ).at(-1),
    ).toMatchObject({ inputTokens: null, steps: [{ confidence: null }] });
    await expect(
      collect({
        evaluate: async () => ({
          answers: { next: { choice: "unavailable", confidence: NaN } },
        }),
      }),
    ).rejects.toThrow("confidence");
    await expect(
      collect({
        evaluate: async () => ({
          answers: { next: { choice: "unavailable" } },
          usage: { inputTokens: -1 },
        }),
      }),
    ).rejects.toThrow("usage");
  });

  it("honors abort before and during evaluation, including uncooperative adapters", async () => {
    const before = AbortSignal.abort(new Error("stopped"));
    const evaluate = scripted([]);
    await expect(collect({ signal: before, evaluate })).rejects.toThrow(
      "stopped",
    );
    expect(evaluate).not.toHaveBeenCalled();
    const controller = new AbortController();
    await expect(
      collect({
        signal: controller.signal,
        evaluate: async () => {
          queueMicrotask(() => controller.abort(new Error("stopped")));
          return new Promise(() => {});
        },
      }),
    ).rejects.toThrow("stopped");
  });
});
