import { expect, test } from "@playwright/test";
import type { TimelineTranscriptItem } from "../../contracts/timeline-types";
import {
  conversationCopyResponseMarkdown,
  conversationCopyToolContent,
  conversationCopyTranscriptMarkdown,
} from "../../src/features/conversation/conversation-copy";

const IMAGE_DATA = "iVBORw0KGgoAAAANS-this-image-payload-must-not-export";
const CREDENTIAL_SENTINEL = "credential-secret-sentinel";
const TOKEN_SENTINEL = "ordinary-token-must-not-export";
const CLIENT_SECRET_SENTINEL = "client-secret-must-not-export";
const PRIVATE_KEY_SENTINEL = "private-key-must-not-export";
const ACCESS_TOKEN_SENTINEL = "access-token-must-not-export";
const REFRESH_TOKEN_SENTINEL = "refresh-token-must-not-export";
const ID_TOKEN_SENTINEL = "id-token-must-not-export";
const HEADER_SENTINEL = "header-container-must-not-export";
const RUNTIME_SENTINEL = "runtime-private-sentinel";
const RUNTIME_VALUE_OMITTED = "[runtime value omitted]";

const transcript = [
  {
    kind: "message",
    id: "user-1",
    sourceMessageId: "user-entry-1",
    role: "user",
    text: "Inspect context.md:12-14 and keep this prompt.",
    createdAt: "2026-10-31T00:00:00.000Z",
    attachments: [
      {
        kind: "image",
        name: "diagram.png",
        mimeType: "image/png",
        data: IMAGE_DATA,
      },
      {
        kind: "file",
        name: "context.md",
        mimeType: "text/markdown",
        fsPath: "/workspace/context.md",
      },
    ],
  },
  {
    kind: "tool",
    id: "call-1",
    callId: "call-1",
    toolName: "terminal",
    status: "error",
    label: "Ran terminal command",
    detail: "Command cancelled",
    metadata: "2.0s",
    createdAt: "2026-10-31T00:00:01.000Z",
    input: {
      command: "cat /workspace/context.md",
      binary: new Uint8Array([1, 2, 3]),
      credential: { token: CREDENTIAL_SENTINEL },
      runtime: { sandboxId: RUNTIME_SENTINEL },
      token: TOKEN_SENTINEL,
      clientSecret: CLIENT_SECRET_SENTINEL,
      private_key: PRIVATE_KEY_SENTINEL,
      nested: [
        { "access-token": ACCESS_TOKEN_SENTINEL },
        { REFRESH_TOKEN: REFRESH_TOKEN_SENTINEL },
        { idToken: ID_TOKEN_SENTINEL },
      ],
      tokenCount: 42,
      tokenizer: "cl100k",
      clientId: "public-client-id",
      public_key: "public-key-reference",
      path: "/workspace/token/clientSecret/private_key.ts",
      prose: "The words token, clientSecret and private_key remain ordinary prose.",
      code: 'const clientSecret = "source-code-remains-exact";',
    },
    output: {
      content: [
        { type: "text", text: "Command cancelled by user" },
        { type: "image", mimeType: "image/png", data: IMAGE_DATA },
      ],
      status: "cancelled",
      file: "/workspace/context.md",
    },
  },
  {
    kind: "summary",
    id: "summary-1",
    label: "Read 1 file",
    metadata: "Turn complete",
    presentation: "inline",
    createdAt: "2026-10-31T00:00:02.000Z",
  },
  {
    kind: "activity",
    id: "activity-1",
    label: "Stopped",
    detail: "The run was cancelled",
    metadata: "1m",
    tone: "warning",
    createdAt: "2026-10-31T00:00:03.000Z",
  },
  {
    kind: "custom",
    id: "custom-1",
    customType: "review",
    text: "Extension review kept in order.",
    createdAt: "2026-10-31T00:00:04.000Z",
  },
  {
    kind: "card",
    id: "card-1",
    createdAt: "2026-10-31T00:00:05.000Z",
    card: {
      title: "Verification",
      subtitle: "Stable references survive export.",
      tone: "success",
      rows: [{ label: "Status", value: "Ready" }],
      actions: [{ type: "openFile", label: "Open context", path: "/workspace/context.md" }],
    },
  },
  {
    kind: "message",
    id: "summary-message",
    role: "compactionSummary",
    text: "Compaction-visible sentinel retained.",
    createdAt: "2026-10-31T00:00:06.000Z",
  },
  {
    kind: "message",
    id: "assistant-1",
    role: "assistant",
    text: "Exact assistant response.",
    createdAt: "2026-10-31T00:00:07.000Z",
  },
] satisfies readonly TimelineTranscriptItem[];

test("response copy returns exactly the source response Markdown", () => {
  const response = [
    "## Result",
    "",
    "Keep **this** exactly.",
    "",
    "```ts",
    "const exact = true;",
    "```",
    "",
  ].join("\n");
  expect(conversationCopyResponseMarkdown(response)).toBe(response);
});

test("transcript copy is deterministic Markdown in loaded transcript order", () => {
  const markdown = conversationCopyTranscriptMarkdown(transcript);
  const again = conversationCopyTranscriptMarkdown(transcript);

  expect(again).toBe(markdown);
  expect(markdown).toContain("# Active branch transcript");
  expect(markdown).toContain("> Scope: complete Markdown for the currently loaded active branch.");
  expect(markdown).toContain("Deleted branches and unloaded history are not included.");
  expect(markdown.indexOf("## User")).toBeLessThan(
    markdown.indexOf("## Tool: Ran terminal command"),
  );
  expect(markdown.indexOf("## Tool: Ran terminal command")).toBeLessThan(
    markdown.indexOf("## Status: Read 1 file"),
  );
  expect(markdown.indexOf("## Status: Read 1 file")).toBeLessThan(
    markdown.indexOf("## Activity: Stopped"),
  );
  expect(markdown.indexOf("## Extension message: review")).toBeLessThan(
    markdown.indexOf("## Verification"),
  );
  expect(markdown.indexOf("## Verification")).toBeLessThan(
    markdown.indexOf("## Compaction summary"),
  );
  expect(markdown.endsWith("Exact assistant response.\n")).toBe(true);
});

test("transcript copy preserves text and file references, tools, and terminal states", () => {
  const markdown = conversationCopyTranscriptMarkdown(transcript);

  expect(markdown).toContain("Inspect context.md:12-14 and keep this prompt.");
  expect(markdown).toContain("File attachment: context.md (text/markdown)");
  expect(markdown).toContain("`/workspace/context.md`");
  expect(markdown).toContain("- Status: error");
  expect(markdown).toContain("Command cancelled by user");
  expect(markdown).toContain('"status": "cancelled"');
  expect(markdown).toContain("Open context (openFile)");
  expect(markdown).toContain("Compaction-visible sentinel retained.");
});

test("transcript copy excludes image payloads, binary values, credentials, and runtime objects", () => {
  const markdown = conversationCopyTranscriptMarkdown(transcript);

  expect(markdown).not.toContain(IMAGE_DATA);
  expect(markdown).not.toContain(CREDENTIAL_SENTINEL);
  expect(markdown).not.toContain(TOKEN_SENTINEL);
  expect(markdown).not.toContain(CLIENT_SECRET_SENTINEL);
  expect(markdown).not.toContain(PRIVATE_KEY_SENTINEL);
  expect(markdown).not.toContain(ACCESS_TOKEN_SENTINEL);
  expect(markdown).not.toContain(REFRESH_TOKEN_SENTINEL);
  expect(markdown).not.toContain(ID_TOKEN_SENTINEL);
  expect(markdown).not.toContain(RUNTIME_SENTINEL);
  expect(markdown).not.toContain('"credential"');
  expect(markdown).not.toContain('"runtime"');
  expect(markdown).not.toContain('"token"');
  expect(markdown).not.toContain('"clientSecret"');
  expect(markdown).not.toContain('"private_key"');
  expect(markdown).not.toContain('"access-token"');
  expect(markdown).not.toContain('"REFRESH_TOKEN"');
  expect(markdown).not.toContain('"idToken"');
  expect(markdown).toContain("Image attachment omitted: diagram.png (image/png)");
  expect(markdown).toContain("[image data omitted]");
  expect(markdown).toContain("[binary omitted]");
});

test("one structured policy covers camel, snake, kebab, case, nested and container variants", () => {
  const sentinel = "STRUCTURED-CREDENTIAL-SENTINEL";
  const input = {
    token: sentinel,
    TOKEN: sentinel,
    clientSecret: sentinel,
    client_secret: sentinel,
    "client-secret": sentinel,
    privateKey: sentinel,
    private_key: sentinel,
    PRIVATE_KEY: sentinel,
    "access-token": sentinel,
    refresh_token: sentinel,
    IDToken: sentinel,
    "id-token": sentinel,
    API_KEY: sentinel,
    "api-key": sentinel,
    Password: sentinel,
    authorization: sentinel,
    Cookie: sentinel,
    header: { arbitrarySingularValue: HEADER_SENTINEL },
    HEADER: [{ arbitraryUpperValue: HEADER_SENTINEL }],
    "h-e-a-d-e-r": { arbitraryKebabValue: HEADER_SENTINEL },
    headers: { arbitraryPluralValue: HEADER_SENTINEL, Authorization: sentinel },
    credentials: { inner: sentinel },
    secrets: [{ value: sentinel }],
    auth: { header: sentinel },
    nested: [{ token: sentinel }, [{ refreshToken: sentinel }]],
  };
  const output = {
    content: [{ type: "text", text: "header output remains visible" }],
    details: {
      header: { arbitraryOutputValue: HEADER_SENTINEL },
      Headers: { arbitraryPluralOutputValue: HEADER_SENTINEL },
      nested: [{ H_E_A_D_E_R: { arbitraryNestedOutputValue: HEADER_SENTINEL } }],
    },
  };
  const toolTranscript = [
    {
      kind: "tool",
      id: "ordinary-fields",
      callId: "ordinary-fields",
      toolName: "provider-api",
      status: "success",
      label: "Provider API",
      createdAt: "2026-10-31T00:00:00.000Z",
      input,
      output,
    },
  ] satisfies readonly TimelineTranscriptItem[];

  const markdown = conversationCopyTranscriptMarkdown(toolTranscript);
  const copied = conversationCopyToolContent(input, output);
  for (const result of [markdown, copied]) {
    expect(result).not.toContain(sentinel);
    expect(result).not.toContain(HEADER_SENTINEL);
    expect(result).toContain("header output remains visible");
  }
});

test("structured copy preserves false positives and opaque prose or code", () => {
  const input = {
    tokenCount: 42,
    tokenizer: "cl100k",
    clientId: "public-client-id",
    public_key: "public-key-reference",
    path: "/workspace/token/clientSecret/private_key.ts",
    headerCount: 3,
    headerName: "public-header-name",
    prose: "The words token, clientSecret and private_key remain ordinary prose.",
    headerProse: "The words header and headers remain ordinary prose.",
    code: 'const clientSecret = "source-code-remains-exact";',
    headers: { authorization: "OMITTED", "x-request-id": "header-preserved" },
  };
  const content = conversationCopyToolContent(input, undefined);

  expect(content).toContain('"tokenCount": 42');
  expect(content).toContain('"tokenizer": "cl100k"');
  expect(content).toContain('"clientId": "public-client-id"');
  expect(content).toContain('"public_key": "public-key-reference"');
  expect(content).toContain('"path": "/workspace/token/clientSecret/private_key.ts"');
  expect(content).toContain('"headerCount": 3');
  expect(content).toContain('"headerName": "public-header-name"');
  expect(content).toContain(
    '"prose": "The words token, clientSecret and private_key remain ordinary prose."',
  );
  expect(content).toContain('"headerProse": "The words header and headers remain ordinary prose."');
  expect(content).toContain('"code": "const clientSecret = \\"source-code-remains-exact\\";"');
  expect(content).not.toContain('"headers"');

  const opaqueProse = "token clientSecret private_key are words in prose";
  const opaqueCode = 'const token = "source code remains exact";';
  expect(conversationCopyToolContent(opaqueProse, opaqueCode)).toBe(
    `${opaqueProse}\n\n${opaqueCode}`,
  );
});

test("structured copy excludes accessors, classes, images, binary and cyclic values", () => {
  let getterCalls = 0;
  const accessorInput = {};
  Object.defineProperty(accessorInput, "ordinaryAccessor", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "ACCESSOR-MUST-NOT-RUN";
    },
  });
  class RuntimeState {
    readonly sandbox = RUNTIME_SENTINEL;
  }
  const circularObject: Record<string, unknown> = {};
  circularObject.self = circularObject;
  const circularArray: unknown[] = [];
  circularArray.push(circularArray);
  const input = {
    ordinaryAccessor: accessorInput,
    service: new RuntimeState(),
    circularObject,
    circularArray,
    image: { type: "image", mimeType: "image/png", src: `data:image/png;base64,${IMAGE_DATA}` },
    binary: new Uint8Array([1, 2, 3]),
  };

  const markdown = conversationCopyTranscriptMarkdown([
    {
      kind: "tool",
      id: "structured-edge-cases",
      callId: "structured-edge-cases",
      toolName: "inspect",
      status: "success",
      label: "Inspect",
      createdAt: "2026-10-31T00:00:00.000Z",
      input,
    },
  ]);
  const copied = conversationCopyToolContent(input, undefined);

  expect(getterCalls).toBe(0);
  for (const output of [markdown, copied]) {
    expect(output).not.toContain("ACCESSOR-MUST-NOT-RUN");
    expect(output).not.toContain(RUNTIME_SENTINEL);
    expect(output).not.toContain(IMAGE_DATA);
    expect(output).toContain(RUNTIME_VALUE_OMITTED);
    expect(output).toContain("[circular data omitted]");
    expect(output).toContain("[image data omitted]");
    expect(output).toContain("[binary omitted]");
  }
});
