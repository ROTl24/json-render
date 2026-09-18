import {
  experimental_composeSpec,
  experimental_createEvaluator,
  type Experimental_CompositionEvaluator,
  type Experimental_CompositionEvent,
  type Experimental_CompositionStep,
  type Spec,
} from "@json-render/core";
import { playgroundCatalog } from "../render/catalog";
import { buildCandidates, MAX_ELEMENTS, platformState } from "./grammar";

export type Evaluate = Experimental_CompositionEvaluator;
export type TraceStep = Experimental_CompositionStep;
export type CompositionEvent =
  | Extract<Experimental_CompositionEvent, { type: "step" }>
  | (Extract<Experimental_CompositionEvent, { type: "complete" }> & {
      estimatedCostUsd: number | null;
    })
  | { type: "error"; message: string };

/** The playground supplies its own content and recipes to the public API. */
export async function* composeUI(
  prompt: string,
  signal: AbortSignal,
  evaluate: Evaluate = experimental_createEvaluator({
    model: "typesafe-ai/jev",
    apiKey: process.env.AI_GATEWAY_API_KEY ?? "",
  }),
  initialSpec?: Spec,
): AsyncGenerator<CompositionEvent> {
  for await (const event of experimental_composeSpec({
    catalog: playgroundCatalog,
    candidates: buildCandidates(prompt),
    initialSpec,
    initialState: { ...platformState, ...initialSpec?.state },
    // Share display copy needed to identify an existing element, never field
    // values, raw binding recipes, action params, or renderer state.
    elementDescriptions:
      initialSpec &&
      Object.fromEntries(
        Object.entries(initialSpec.elements).map(([id, element]) => [
          id,
          [
            element.type,
            ...["title", "text", "label", "name", "direction"].flatMap((key) =>
              typeof element.props[key] === "string"
                ? [`${key}: ${JSON.stringify(element.props[key])}`]
                : [],
            ),
          ].join("; "),
        ]),
      ),
    prompt,
    signal,
    evaluate,
    maxSteps: MAX_ELEMENTS,
    maxDepth: 4,
    context: {
      platform:
        "Available: account/contact fields (name, email, password, message, topic, remember-me, notifications); form submit/save/reset demo actions; synthetic sales revenue, orders, customers, a weekly revenue chart, and order-status table. Quoted titles may be copied from the request. Actions run on later user interaction. Submission is a validation/toast demo, not an authentication or messaging service.",
    },
    instructions: {
      root: "Use Card for a compact form. Use vertical Stack for a page with a heading and several sections, including a dashboard containing a metric row followed by charts or tables. Use Grid as root only when the entire page is one uniform grid of peers.",
      next: "Before adding a requested side-by-side group, add its Grid or horizontal Stack if missing. Add only requested content or conventional essentials (login needs email, password, and submit). Prefer a compact tree.",
      parent:
        "Never put headings or form fields inside a horizontal button row. Choose the root for a new top-level section.",
    },
  })) {
    if (event.type === "complete") {
      yield {
        ...event,
        estimatedCostUsd:
          event.inputTokens === null ? null : (event.inputTokens * 0.042) / 1e6,
      };
    } else yield event;
  }
}
