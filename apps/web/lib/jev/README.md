# Jev composing catalog UI

Open **`/playground`** and select **Jev (Experimental)** in the model selector. This experiment starts with an empty spec and uses Jev through Vercel AI Gateway to compose a new tree. It renders with the **actual playground catalog and registry**, including the existing shadcn components, state bindings, validation, and action handlers.

## Run

Set `AI_GATEWAY_API_KEY` in `apps/web/.env.local` or the server environment. The Gateway team must permit the `typesafe-ai` provider. No separate TypeSafe API key is required.

From the repository root:

```sh
pnpm --filter web dev
```

Use the portless URL printed by the command, followed by `/playground`. With the HTTPS proxy enabled this is `https://json-render.localhost/playground`.

Select Jev, choose Create account settings, and send the request. Edit the name, switch notifications on, click Save changes, and then Reset. The action handlers run only on user interaction. Form submission validates and shows a toast; it does not authenticate a user or send a message. All business data is synthetic.

## How Jev produces a spec

Jev exposes Choice, Boolean, and Score outputs. It does not produce free-form JSON or prose. We express UI construction as a sequence of finite choices:

1. Begin with an empty spec and platform state.
2. Offer allowed catalog operations, such as adding an email Input with a state binding, a Grid with three columns, or a Button bound to `formSubmit`.
3. Jev chooses the next operation and an existing container to receive it. Once multiple parents exist, the two choices are returned in the same evaluation call.
4. Code resolves the chosen operation into an element, assigns its ID, adds the tree edge, and validates the result against the catalog and initial state. Action names, events, and parameters are also checked.
5. Stream the valid spec to the existing renderer. Feed a compact description of the constructed tree into the next evaluation.
6. Stop when Jev chooses `finish` or `unavailable`, or the code reaches its element/call limit.

There are **no complete UI templates** and no generative-model calls. The example prompt buttons only populate the request text. Jev chooses which elements to include, their order, grouping, and which offered action bindings to use. The registry owns appearance and behavior.

The loop resembles autoregressive generation at the level of catalog operations. Jev does not author the serialized JSON; code assembles it from the choices.

## What the platform must supply

A component catalog bounds component names, props, and events, but string and array props still have open-ended values. This example closes that remaining space with platform-owned content and binding recipes:

- 15 component types from the playground catalog: Card, Stack, Grid, Heading, Input, Textarea, Select, Checkbox, Switch, Button, Text, Metric, BarGraph, Table, and Separator.
- Form fields, validation rules, labels, synthetic commerce data, and two allowed catalog actions (`formSubmit` and `setState`).
- Several useful values for layout props and button labels. Quoted titles in the request are copied into additional Heading choices.

These are **atomic element candidates**, not page templates. A host application could build them from its actual data schema, records, localized copy, and permitted operations. This example supplies those values in `grammar.ts`; apps supply their own candidates to the reusable core API. Repeating the same field in multiple forms and arbitrary new text/data are not supported.

## Limits

The composer validates tree structure and candidate values; it does not guarantee that Jev chose the right UI. Root selection, grouping, and deciding when to stop require planning, which is a documented weakness of Jev. Confidence is displayed without a quality gate: multiple layout choices may be reasonable, and a universal threshold has not been calibrated.

The code bounds composition to 14 elements / evaluation calls, nesting depth four, ten seconds per provider request, and 55 seconds overall. A limit, cancellation, or error leaves a visibly partial preview. The shared endpoint uses the web app's request rate limiters. Each Jev request starts from an empty spec; select the default model for iterative edits. The stream tab exposes construction decisions alongside spec patches. Provider calls and spec assembly never execute the selected UI actions.


## Transport and files

The server uses Gateway's experimental v4 evaluation transport with model `typesafe-ai/jev`. This was verified against `@ai-sdk/gateway@4.0.85`. Native fetch avoids upgrading the workspace's AI SDK 6 dependencies or bypassing its minimum release age. The protocol can change; migrate to the eligible AI SDK evaluation API with a plain model string when appropriate.

- `grammar.ts`: playground-owned values and atomic candidates.
- `packages/core/src/experimental-compose.ts`: public provider-independent composer.
- `packages/core/src/experimental-evaluator.ts`: public Gateway evaluator adapter.
- `compose.ts`: public API consumer with playground instructions and cost display.
- `../../app/api/generate/route.ts`: shared rate-limited endpoint, dispatching the selected model.
- `response.ts`: adapts composition snapshots into the playground's JSONL spec patches and decision metadata.
- `../../components/playground.tsx`: shared model selector, prompt, version history, live preview, and inspectors.
- `compose.test.ts`: structure, action boundaries, unknown usage, cancellation, and limits.

```sh
pnpm exec vitest run packages/core/src/experimental-compose.test.ts packages/core/src/experimental-evaluator.test.ts apps/web/lib/jev/compose.test.ts
pnpm type-check
```

References: [Jev on Gateway](https://vercel.com/ai-gateway/models/jev), [AI SDK evaluation](https://ai-sdk.dev/docs/ai-sdk-core/evaluation), [Jev's documented limits](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

For app integration and source-build installation, see the [Jev guide](https://json-render.dev/docs/jev). The `experimental_` APIs may change in any release; pin exact versions.
