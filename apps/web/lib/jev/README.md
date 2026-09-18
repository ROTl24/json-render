# Jev composing catalog UI

Open **`/playground`** and select **jev** in the **default / jev** toggle. Hover or focus the Jev option with its info icon to read its experimental status. This experiment uses Jev through Vercel AI Gateway to compose a tree and edit it in follow-up requests. It renders with the **actual playground catalog and registry**, including the existing shadcn components, state bindings, validation, and action handlers.

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

1. Begin with the selected version, or an empty spec and platform state for the first request.
2. Offer allowed catalog operations, such as adding an email Input with a state binding, a Grid with three columns, or a Button bound to `formSubmit`.
3. Jev chooses the next operation and an existing container to receive it. Once multiple parents exist, the two choices are returned in the same evaluation call.
4. Code resolves the chosen operation into an element, assigns its ID, adds the tree edge, and validates the result against the catalog and initial state. Action names, events, and parameters are also checked.
5. Stream the valid spec to the existing renderer. Feed a compact description of the constructed tree into the next evaluation.
6. On follow-ups, also offer replacement, removal, and move/reorder operations. Replacements and moves select a target, then choose a valid recipe or destination in a second evaluation. Preserve unchanged elements and earlier versions.
7. Stop when Jev chooses `finish` or `unavailable`, or the code reaches its evaluation limit.

There are **no complete UI templates** and no generative-model calls. The example prompt buttons only populate the request text. Jev chooses which elements to include, their order, grouping, and which offered action bindings to use. The registry owns appearance and behavior.

The loop resembles autoregressive generation at the level of catalog operations. Jev does not author the serialized JSON; code assembles it from the choices.

## What the platform must supply

A component catalog bounds component names, props, and events, but string and array props still have open-ended values. This example closes that remaining space with platform-owned content and binding recipes:

- 17 component types from the playground catalog: Card, Stack, Grid, Heading, Avatar, Badge, Input, Textarea, Select, Checkbox, Switch, Button, Text, Metric, BarGraph, Table, and Separator.
- Form fields, validation rules, labels, synthetic profile and commerce data, and two allowed catalog actions (`formSubmit` and `setState`). Profile choices include an avatar, display name, role, bio, email, location, and membership badge, bound to the supplied record.
- Several useful values for layout props and button labels. Quoted titles in the request are copied into additional Heading choices.

These are **atomic element candidates**, not page templates. A host application could build them from its actual data schema, records, localized copy, and permitted operations. This example supplies those values in `grammar.ts`; apps supply their own candidates to the reusable core API. Repeating the same field in multiple forms and arbitrary new text/data are not supported.

## Limits

The composer validates tree structure and candidate values; it does not guarantee that Jev chose the right UI. Root selection, grouping, and deciding when to stop require planning, which is a documented weakness of Jev. Confidence is displayed without a quality gate: multiple layout choices may be reasonable, and a universal threshold has not been calibrated.

The code bounds each request to 14 evaluation calls, nesting depth four, ten seconds per provider request, and 55 seconds overall. The selected seed may contain up to 100 elements. A limit, cancellation, or error retains the current preview and labels it partial. The shared endpoint uses the web app's request rate limiters. Both models edit the selected version; Clear starts fresh. The stream tab exposes construction decisions alongside spec patches. Provider calls and spec assembly never execute the selected UI actions.

Try `Design a user profile card`, then `Remove the bio` or `Make the avatar smaller`. For settings, try `Remove the email notifications switch`, `Change the heading to "Account settings"`, or `Move the email field above the name field`. The server shares existing display labels and matching candidate descriptions to identify edit targets, without sharing raw state or entered field values. Existing specs must use the supported expression subset and form a valid tree. Edits retain state from the selected spec, as in the default model flow; interactive preview state is not saved into version history.


## Transport and files

The server uses Gateway's experimental v4 evaluation transport with model `typesafe-ai/jev`. This was verified against `@ai-sdk/gateway@4.0.85`. Native fetch avoids upgrading the workspace's AI SDK 6 dependencies or bypassing its minimum release age. The protocol can change; migrate to the eligible AI SDK evaluation API with a plain model string when appropriate.

- `grammar.ts`: playground-owned values and atomic candidates.
- `packages/core/src/experimental-compose.ts`: public provider-independent composer.
- `packages/core/src/experimental-composition-tree.ts`: internal seed validation and tree edit helpers.
- `packages/core/src/experimental-evaluator.ts`: public Gateway evaluator adapter.
- `compose.ts`: public API consumer with playground instructions and cost display.
- `../../app/api/generate/route.ts`: shared rate-limited endpoint, dispatching the selected model.
- `response.ts`: adapts composition snapshots into the playground's JSONL spec patches and decision metadata.
- `../../components/playground.tsx`: shared model toggle, experimental info tooltip, prompt, version history, live preview, and inspectors.
- `compose.test.ts`: structure, action boundaries, unknown usage, cancellation, and limits.

```sh
pnpm exec vitest run packages/core/src/experimental-compose.test.ts packages/core/src/experimental-evaluator.test.ts apps/web/lib/jev/compose.test.ts
pnpm type-check
```

References: [Jev on Gateway](https://vercel.com/ai-gateway/models/jev), [AI SDK evaluation](https://ai-sdk.dev/docs/ai-sdk-core/evaluation), [Jev's documented limits](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

For app integration and source-build installation, see the [Jev guide](https://json-render.dev/docs/jev). The `experimental_` APIs may change in any release; pin exact versions.
