import { afterEach, assert, describe, expect, it, vi } from "vitest";
import type { ToolsCatalogResult, ToolsEffectiveResult } from "../../api/types.ts";
import {
  availableIdentity,
  createIdentityFixture,
} from "../../features/github-connections/github-identity-harness.test-support.ts";
import { githubIdentityViewFixture } from "../../features/github-connections/github-identity.test-support.ts";
import { captureI18nStateForTesting } from "../../i18n/lib/translate.test-support.ts";
import { i18n } from "../../i18n/lib/translate.ts";
import type { SolidBridgeElement } from "../../lib/solid-bridge.ts";
import { installBrowserHistoryIsolation } from "../../test-helpers/browser-history.ts";
import { mountSolid as mountConnected } from "../../test-helpers/mount-solid.ts";
import { cleanupSolid } from "../../test-helpers/solid-cleanup.ts";
import { mountSolid } from "../../test-helpers/solid-render.tsx";
import { waitForSolid } from "../../test-helpers/solid-settle.ts";
import { createBaseParams, createReadToolCatalog } from "./panels-tools-skills.test-support.ts";
import { AgentTools } from "./panels-tools-skills.tsx";

installBrowserHistoryIsolation();
afterEach(cleanupSolid);

function mountTools(
  overrides: Parameters<typeof createBaseParams>[0] = {},
  container?: HTMLElement,
) {
  return mountSolid(AgentTools, createBaseParams(overrides), container);
}

const text = (element: Element | null | undefined) => element?.textContent?.trim();
const texts = (root: Element, selector: string) =>
  Array.from(root.querySelectorAll(selector), text);
const content = (root: Element, selector: string) => text(root.querySelector(selector));
type CatalogTool = ToolsCatalogResult["groups"][number]["tools"][number];
const catalogTool = (
  id: string,
  description: string,
  overrides: Partial<CatalogTool> = {},
): CatalogTool => ({
  id,
  label: id,
  description,
  source: "core",
  defaultProfiles: [],
  ...overrides,
});
type PreviewTool = ToolsEffectiveResult["groups"][number]["tools"][number];
const previewTool = (
  id: string,
  label: string,
  description: string,
  overrides: Partial<PreviewTool> = {},
): PreviewTool => ({
  id,
  label,
  description,
  rawDescription: description,
  source: "core",
  ...overrides,
});
const button = (root: Element, label: string) => {
  const control = Array.from(root.querySelectorAll("button")).find(
    (entry) => text(entry) === label,
  );
  assert(control, `Missing control: ${label}`);
  return control;
};
const toolSwitch = (root: Element, id: string) => {
  const card = Array.from(root.querySelectorAll(".agent-tool-card")).find(
    (entry) => content(entry, ".agent-tool-title") === id,
  );
  const control = card?.querySelector<HTMLInputElement>("input.settings-toggle__input");
  assert(control, `Missing tool switch: ${id}`);
  return control;
};

function policyCatalog(ids: string[], profile = "full"): ToolsCatalogResult {
  return {
    agentId: "main",
    profiles: [{ id: profile, label: profile === "full" ? "Full" : "Minimal" }],
    groups: [
      {
        id: "policy",
        label: "Policy",
        source: "core",
        tools: ids.map((id) => catalogTool(id, id)),
      },
    ],
  };
}

function agentIdentity(client: Parameters<typeof createIdentityFixture>[0]) {
  const { identity, sync } = createIdentityFixture(
    client,
    {
      runExternalMutation: async () => ({ ok: false, reason: "unavailable", error: "not used" }),
    },
    { scope: "agent" },
  );
  sync();
  return identity;
}

async function settleGitHubIdentity(container: HTMLElement) {
  if (!container.isConnected) {
    mountConnected(() => container);
  }
  const bridge = container.querySelector<SolidBridgeElement<object>>("openclaw-github-identity");
  assert(bridge, "Missing GitHub identity bridge");
  await bridge.updateComplete;
}

const toolPreview: ToolsEffectiveResult = {
  agentId: "main",
  profile: "full",
  groups: [
    {
      id: "core",
      label: "Built-in tools",
      source: "core",
      tools: [previewTool("read", "read", "Read files")],
    },
  ],
  notices: [{ id: "mcp-not-yet-listed", severity: "info", message: "Discovery is incomplete." }],
};

describe("agents tools panel (browser)", () => {
  it("updates preset and catalog labels when the mounted panel changes language", async () => {
    const restoreI18n = captureI18nStateForTesting();
    try {
      await i18n.setLocale("en");
      const { container } = mountTools({
        catalog: {
          agentId: "main",
          profiles: [{ id: "coding", label: "Coding" }],
          groups: [{ id: "media", label: "Media", source: "core", tools: [] }],
        },
      });
      const presetLabel = () => content(container, ".agent-tools-buttons button");
      const groupLabel = () => content(container, ".agent-tools-group__title");
      expect(presetLabel()).toBe("Coding");
      expect(groupLabel()).toBe("Media");

      await i18n.setLocale("de");
      await waitForSolid(() => {
        expect(presetLabel()).toBe("Programmierung");
        expect(groupLabel()).toBe("Medien");
      });
    } finally {
      await restoreI18n();
    }
  });

  it.each([
    { name: "not requested", overrides: {}, status: "Not loaded" },
    {
      name: "another agent",
      overrides: { runtimeSessionMatchesSelectedAgent: false, effective: toolPreview },
      status: "Other Agent",
    },
  ])("does not treat a $name preview as zero tools or denied access", ({ overrides, status }) => {
    const container = document.createElement("div");
    const params = createBaseParams(overrides);
    if (params.effective) {
      params.effective = {
        ...params.effective,
        toolAccess: {
          checked: "live-session",
          profiles: [],
          tools: [
            {
              id: "exec",
              status: "excluded",
              reasons: [{ kind: "profile", label: "Old profile exclusion" }],
            },
          ],
        },
      };
    }
    mountSolid(AgentTools, params, container);

    expect(container.querySelectorAll(".settings-kv dd")[3]?.textContent?.trim()).toBe(status);
    expect(container.querySelector(".agent-tools-runtime-chip")).toBeNull();
    expect(container.querySelector(".agent-tools-notices")).toBeNull();
    const row = container.querySelector("#agent-tool-exec");
    expect(row?.textContent).not.toContain("Old profile exclusion");
    expect(row?.querySelector(".agent-tool-policy")).toBeNull();
    expect(row?.querySelectorAll(".agent-tool-summary__fact dd")[1]?.textContent?.trim()).toBe(
      status,
    );
    expect(row?.textContent).not.toContain("Not Live");
    expect(row?.textContent).not.toContain("Not available in this chat session");
  });

  it("distinguishes missing preview entries from disabled tools and an empty result", () => {
    const container = document.createElement("div");
    const params = createBaseParams({ effective: toolPreview });
    const view = mountSolid(AgentTools, params, container);

    const included = container.querySelector("#agent-tool-read");
    const absent = container.querySelector("#agent-tool-exec");
    expect(included?.querySelectorAll(".agent-tool-summary__fact dd")[1]?.textContent?.trim()).toBe(
      "Included in preview",
    );
    expect(included?.textContent).toContain("Listed in preview via Built-In.");
    expect(absent?.querySelectorAll(".agent-tool-summary__fact dd")[1]?.textContent?.trim()).toBe(
      "Not listed",
    );
    expect(absent?.querySelector<HTMLInputElement>("input.settings-toggle__input")?.checked).toBe(
      true,
    );
    expect(container.querySelector(".agent-tools-group__counts")?.textContent).toContain(
      "1 Listed Tool",
    );

    view.update({
      ...params,
      effective: {
        ...toolPreview,
        groups: [{ id: "core", label: "Built-in tools", source: "core", tools: [] }],
      },
    });
    expect(container.querySelectorAll(".settings-kv dd")[3]?.textContent?.trim()).toBe("0");
    expect(container.textContent).toContain("No tools are listed in this preview.");
    expect(container.querySelector(".agent-tools-runtime-chip")).toBeNull();
  });

  it("renders catalog provenance and a prospective tool preview", async () => {
    const { container } = mountTools({
      catalog: {
        agentId: "main",
        profiles: [
          { id: "minimal", label: "Minimal" },
          { id: "coding", label: "Coding" },
          { id: "messaging", label: "Messaging" },
          { id: "full", label: "Full" },
        ],
        groups: [
          {
            id: "media",
            label: "Media",
            source: "core",
            tools: [catalogTool("tts", "Text-to-speech conversion")],
          },
          {
            id: "plugin:voice-call",
            label: "voice-call",
            source: "plugin",
            pluginId: "voice-call",
            tools: [
              catalogTool("voice_call", "Voice call tool", {
                source: "plugin",
                pluginId: "voice-call",
                optional: true,
              }),
            ],
          },
        ],
      },
      effective: {
        agentId: "main",
        profile: "messaging",
        groups: [
          {
            id: "channel",
            label: "Channel tools",
            source: "channel",
            tools: [
              previewTool(
                "message",
                "Message Actions",
                "Send and manage messages in this channel",
                {
                  source: "channel",
                  channelId: "guildchat",
                },
              ),
            ],
          },
          {
            id: "mcp",
            label: "MCP server tools",
            source: "mcp",
            tools: [
              previewTool("reproProbe__probe_tool", "Probe Tool", "Probe from MCP", {
                source: "mcp",
                pluginId: "bundle-mcp",
              }),
            ],
          },
        ],
      },
    });
    await settleGitHubIdentity(container);

    expect(texts(container, ".settings-section__heading")).toEqual([
      "Tool access",
      "Tool preview",
      "GitHub account",
      "Tool Catalog",
    ]);
    expect(container.querySelectorAll(".settings-kv dd")[3]?.textContent?.trim()).toBe("2");
    expect(container.textContent).toContain(
      "Based on saved session settings and discovered tools.",
    );
    expect(container.textContent).toContain("additional tools may become available");
    expect(container.textContent).toContain("unsaved edits are not included");
    expect(texts(container, ".settings-row__title")).toContain("Tool Presets");
    const runtimeChips = Array.from(container.querySelectorAll(".agent-tools-runtime-chip")).map(
      (chip) => ({
        label: content(chip, ".mono"),
        meta: content(chip, ".agent-tools-runtime-chip__meta"),
      }),
    );
    expect(runtimeChips).toEqual([
      { label: "Message Actions", meta: "Channel: guildchat" },
      { label: "Probe Tool", meta: "MCP" },
    ]);
    expect(texts(container, ".agent-tools-group__title > .settings-row__value")).toEqual([
      "Plugin: voice-call",
    ]);
    expect(
      Array.from(container.querySelectorAll(".agent-tool-card")).map((card) => ({
        title: content(card, ".agent-tool-title"),
        badges: texts(card, ".agent-tool-summary__badges .settings-row__value"),
      })),
    ).toEqual([
      { title: "tts", badges: ["Built-In"] },
      { title: "voice_call", badges: ["Plugin: voice-call", "Optional"] },
    ]);
    expect(container.querySelector(".agent-tool-card[open]")).toBeNull();
  });

  it("renders the GitHub identity section with settings rows only", async () => {
    const container = document.createElement("div");
    const params = createBaseParams();
    const nativeIdentity = {
      ...availableIdentity,
      source: "system-detected" as const,
      credentialKind: "native" as const,
      account: { login: "octocat" },
      gitAuthor: { name: null, email: null },
      accessExpiresAtMs: null,
      refreshState: "not_applicable" as const,
      oauthScopes: [],
    };
    params.githubIdentity = githubIdentityViewFixture({
      status: {
        agentId: "main",
        selectedScope: "system",
        selected: { scope: "system", configured: false, identity: nativeIdentity },
        effective: nativeIdentity,
      },
    });
    mountSolid(AgentTools, params, container);
    await settleGitHubIdentity(container);

    const section = Array.from(container.querySelectorAll(".settings-section")).find((candidate) =>
      candidate.querySelector(".settings-section__heading")?.textContent?.includes("GitHub"),
    );
    expect(section).toBeDefined();
    if (!section) {
      throw new Error("expected GitHub identity section");
    }
    // The whole section stays inside the one group surface: no bespoke form
    // markup or nested callouts, per ui/docs/design-system/settings-design.md.
    expect(section.querySelector(".form-grid")).toBeNull();
    expect(section.querySelector(".callout")).toBeNull();
    expect(section.querySelector(".settings-group .settings-account__avatar")).toBeNull();
    expect(section.textContent).toContain("@octocat");
    expect(content(section, ".settings-status")).toBe("Verified");
    // Raw wire enums never render; friendly labels replace them.
    expect(section.textContent).not.toContain("system-detected");
    expect(section.textContent).not.toContain("github-api");
    const authorRow = Array.from(section.querySelectorAll(".settings-row")).find((row) =>
      row.querySelector(".settings-row__title")?.textContent?.includes("Git Author"),
    );
    expect(authorRow?.querySelector(".settings-row__value")?.textContent?.trim()).toBe("Not set");
    expect(section.querySelector(".settings-segmented")).toBeNull();
    expect(section.querySelector(".settings-secret input")).toBeNull();
    expect(section.textContent).toContain("Manage connections in Profile");
    expect(section.textContent).not.toContain("OS account running the Gateway");
    expect(section.textContent).not.toContain("Advanced: agent GitHub override");
  });

  it("renders only the pinned device link and one-time code while authorization is active", async () => {
    const container = document.createElement("div");
    const client = {
      request: vi.fn(async () => ({
        requestId: "github-device-11111111111111111111111111111111",
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
        expiresInMs: 900_000,
        pollAfterMs: 60_000,
      })),
    } as never;
    const githubIdentity = agentIdentity(client);
    await githubIdentity.startAuthorization();

    mountSolid(AgentTools, createBaseParams({ githubIdentity }), container);
    await settleGitHubIdentity(container);

    expect(container.textContent).toContain("ABCD-1234");
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/login/device"]',
    );
    expect(link?.textContent?.trim()).toBe("Open github.com/login/device");
    expect(link?.target).toBe("_blank");
    expect(link?.rel.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    expect(container.querySelector(".settings-secret input")).toBeNull();
    expect(container.textContent).not.toContain("github-device-11111111111111111111111111111111");
    expect(container.querySelector(".settings-segmented")).toBeNull();
    githubIdentity.dispose();
  });

  it("keeps complete effective facts when This Agent inherits System", async () => {
    const container = document.createElement("div");
    const params = createBaseParams();
    const effective = {
      ...availableIdentity,
      source: "system-configured" as const,
      account: { login: "system-user" },
      gitAuthor: { name: "System Author", email: "system@example.com" },
      oauthScopes: ["repo", "workflow"],
    };
    params.githubIdentity = githubIdentityViewFixture({
      status: {
        agentId: "main",
        selectedScope: "agent",
        selected: { scope: "agent", configured: false, identity: null },
        effective,
      },
    });

    mountSolid(AgentTools, params, container);
    await settleGitHubIdentity(container);

    expect(container.textContent).toContain("@system-user");
    expect(container.textContent).toContain("System Author · system@example.com");
    expect(container.textContent).toContain("Managed GitHub authorization");
    expect(container.textContent).toContain("repo, workflow");
    expect(container.textContent).toContain("System GitHub");
    expect(container.textContent).not.toContain("OS account running the Gateway");
  });

  it("keeps PAT fields hidden until the explicit fallback is selected", async () => {
    const container = document.createElement("div");
    const client = { request: vi.fn() } as never;
    const githubIdentity = agentIdentity(client);

    const view = mountSolid(AgentTools, createBaseParams({ githubIdentity }), container);
    await settleGitHubIdentity(container);
    expect(container.querySelector(".settings-secret input")).toBeNull();
    expect(container.textContent).toContain("Use a PAT instead");

    githubIdentity.showPatFallback();
    await settleGitHubIdentity(container);
    expect(container.querySelector(".settings-secret input")).not.toBeNull();
    expect(container.textContent).not.toContain("Continue with GitHub");

    view.update(
      createBaseParams({
        githubIdentity: githubIdentityViewFixture({ ...githubIdentity.read(), busy: true }),
      }),
    );
    await settleGitHubIdentity(container);
    expect(button(container, "Cancel").disabled).toBe(true);
  });

  it("enables the fallback setup helper without selecting Full", async () => {
    const onOverridesChange = vi.fn();
    const onProfileChange = vi.fn();
    const { container } = mountTools({
      configForm: { agents: { entries: { main: { tools: { profile: "coding" } } } } },
      onOverridesChange,
      onProfileChange,
    });
    await Promise.resolve();

    expect(container.textContent).toContain(
      "Full selects tools; it does not grant Full Access execution permissions.",
    );
    const toggle = toolSwitch(container, "openclaw");
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onOverridesChange).toHaveBeenCalledExactlyOnceWith("main", ["openclaw"], []);
    expect(onProfileChange).not.toHaveBeenCalled();
  });

  it("keeps Inherit separate from the explicit Full profile", async () => {
    const onProfileChange = vi.fn();
    const { container } = mountTools({ onProfileChange });
    await Promise.resolve();

    button(container, "Inherit").click();
    expect(onProfileChange).toHaveBeenCalledExactlyOnceWith("main", null, false);
  });

  it("renders effective tool notices", async () => {
    const { container } = mountTools({
      effective: {
        agentId: "main",
        profile: "full",
        groups: [],
        notices: [
          {
            id: "mcp-not-yet-connected",
            severity: "info",
            message: "MCP servers are configured but not connected yet.",
          },
        ],
      },
    });
    await Promise.resolve();

    expect(content(container, ".agent-tools-notices .callout.info")).toBe(
      "MCP servers are configured but not connected yet.",
    );
  });

  it("closes expanded tool rows when the parent group collapses", async () => {
    const { container } = mountTools({
      catalog: createReadToolCatalog(),
    });
    await Promise.resolve();

    const group = container.querySelector<HTMLDetailsElement>(".agent-tools-group");
    const tool = container.querySelector<HTMLDetailsElement>(".agent-tool-card");

    expect(group).toBeInstanceOf(HTMLDetailsElement);
    expect(tool).toBeInstanceOf(HTMLDetailsElement);

    if (!group || !tool) {
      throw new Error("expected agent tool group and card");
    }

    group.open = true;
    tool.open = true;

    group.open = false;
    group.dispatchEvent(new Event("toggle"));

    expect(tool.open).toBe(false);
  });

  it("keeps the access toggle inside the collapsed tool summary", async () => {
    const { container } = mountTools({
      catalog: createReadToolCatalog(),
    });
    await Promise.resolve();

    const tool = container.querySelector<HTMLDetailsElement>(".agent-tool-card");
    const summary = container.querySelector<HTMLElement>(".agent-tool-summary");
    const toggle = container.querySelector(".agent-tool-toggle input.settings-toggle__input");

    expect(tool?.open).toBe(false);
    expect(toggle?.closest(".agent-tool-summary")).toBe(summary);
  });

  it("uses section-level plugin provenance for tool details", async () => {
    const { container } = mountTools({
      catalog: {
        agentId: "main",
        profiles: [{ id: "full", label: "Full" }],
        groups: [
          {
            id: "plugin:voice-call",
            label: "voice-call",
            source: "plugin",
            pluginId: "voice-call",
            tools: [
              catalogTool("voice_call", "Voice call tool", {
                source: undefined as never,
                defaultProfiles: ["full"],
              }),
            ],
          },
        ],
      },
    });
    await Promise.resolve();

    const tool = container.querySelector<HTMLDetailsElement>(".agent-tool-card");
    tool!.open = true;

    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".agent-tool-detail")).map((detail) => ({
        label: content(detail, ".label"),
        value: detail.lastElementChild?.textContent?.trim(),
      })),
    ).toEqual([
      { label: "Agent setting", value: "Enabled by the current profile." },
      { label: "Source", value: "Plugin: voice-call" },
      { label: "Default Presets", value: "full" },
      { label: "Tool preview", value: "Not loaded" },
    ]);
  });

  it.each([
    { reduced: true, behavior: "auto" },
    { reduced: false, behavior: "smooth" },
  ] as const)("opens a live tool chip with $behavior scrolling", async ({ reduced, behavior }) => {
    const container = document.createElement("div");
    document.body.append(container);
    mountSolid(
      AgentTools,
      createBaseParams({
        catalog: createReadToolCatalog(),
        effective: toolPreview,
      }),
      container,
    );
    await Promise.resolve();

    const group = container.querySelector<HTMLDetailsElement>(".agent-tools-group");
    const tool = container.querySelector<HTMLDetailsElement>(".agent-tool-card");
    const chip = container.querySelector<HTMLAnchorElement>(
      '.agent-tools-runtime-chip[href="#agent-tool-read"]',
    );

    expect(group).toBeInstanceOf(HTMLDetailsElement);
    expect(tool).toBeInstanceOf(HTMLDetailsElement);
    expect(chip?.getAttribute("href")).toBe("#agent-tool-read");

    if (!group || !tool || !chip) {
      container.remove();
      throw new Error("expected agent tool runtime chip");
    }

    expect(group.open).toBe(false);
    expect(tool.open).toBe(false);

    const summary = tool.querySelector<HTMLElement>("summary");
    if (!summary) {
      container.remove();
      throw new Error("expected agent tool summary");
    }
    const scrollIntoView = vi.fn();
    tool.scrollIntoView = scrollIntoView;
    const focus = vi.spyOn(summary, "focus");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: reduced }));
    const previousUrl = window.location.href;
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    try {
      chip.click();
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });

      expect(group.open).toBe(true);
      expect(tool.open).toBe(true);
      expect(replaceState).toHaveBeenCalledOnce();
      const requestedUrl = replaceState.mock.calls[0]?.[2];
      expect(requestedUrl).toBeInstanceOf(URL);
      expect((requestedUrl as URL).hash).toBe("#agent-tool-read");
      expect(window.location.href).toBe(previousUrl);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior });
      expect(focus).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      focus.mockRestore();
      replaceState.mockRestore();
      container.remove();
    }
  });

  it.each([
    {
      name: "enables one profile tool",
      tool: "session_status",
      enabled: true,
      expectedAllow: ["untouched", "exec", "web_*"],
      expectedDeny: ["read", "web_*"],
    },
    {
      name: "disables one aliased tool",
      tool: "bash",
      enabled: false,
      expectedAllow: ["untouched", "web_*"],
      expectedDeny: ["session_status", "read", "web_*", "exec"],
    },
    {
      name: "enables the catalog without removing wildcard denies",
      tool: null,
      enabled: true,
      expectedAllow: ["untouched", "exec", "web_*", "web_fetch"],
      expectedDeny: ["read", "web_*"],
    },
    {
      name: "disables the catalog without removing wildcard allows",
      tool: null,
      enabled: false,
      expectedAllow: ["untouched", "web_*"],
      expectedDeny: ["session_status", "read", "web_*", "exec", "web_fetch"],
    },
    {
      name: "publishes one normalized update for an empty catalog",
      tool: null,
      enabled: true,
      emptyCatalog: true,
      expectedAllow: ["untouched", "exec", "web_*"],
      expectedDeny: ["session_status", "read", "web_*"],
    },
  ])("$name with one immutable override update", async (testCase) => {
    const tools = {
      profile: "minimal",
      alsoAllow: [" untouched ", " BASH ", "exec", "", "web_*"],
      deny: [" SESSION_STATUS ", "read", "web_*", "", "read"],
    };
    const configForm = { agents: { entries: { main: { tools } } } };
    const originalConfig = structuredClone(configForm);
    const onOverridesChange = vi.fn();
    const toolIds = testCase.emptyCatalog ? [] : ["session_status", "bash", "web_fetch"];
    const { container } = mountTools({
      configForm,
      onOverridesChange,
      catalog: policyCatalog(toolIds, "minimal"),
    });
    await Promise.resolve();

    if (testCase.tool) {
      const toggle = toolSwitch(container, testCase.tool);
      expect(toggle.checked).toBe(!testCase.enabled);
      toggle.checked = testCase.enabled;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      button(container, testCase.enabled ? "Enable All" : "Disable All").click();
    }

    expect(onOverridesChange).toHaveBeenCalledExactlyOnceWith(
      "main",
      testCase.expectedAllow,
      testCase.expectedDeny,
    );
    expect(configForm).toEqual(originalConfig);
  });

  it.each([
    ["prefix wildcard", { allow: ["web_*"] }, { web_fetch: true, web_: true, read: false }],
    ["suffix wildcard", { allow: ["*fetch"] }, { web_fetch: true, read: false }],
    [
      "literal dots in wildcard",
      { allow: ["mcp.server.*"] },
      { "mcp.server.tool": true, mcpXserverXtool: false },
    ],
    [
      "base exec alias and direct deny",
      { allow: [" BASH "], deny: ["exec"] },
      { exec: false, apply_patch: false, write: false },
    ],
    [
      "override exec deny",
      { profile: "full", deny: ["exec"] },
      { exec: false, apply_patch: true, write: true },
    ],
    [
      "base write allow includes patching",
      { allow: ["write"] },
      { write: true, apply_patch: true, exec: false },
    ],
    [
      "override write allow includes patching",
      { profile: "minimal", alsoAllow: ["write"] },
      { write: true, apply_patch: true, exec: false },
    ],
    [
      "explicit patch deny wins over write allow",
      { profile: "minimal", alsoAllow: ["write"], deny: ["apply_patch"] },
      { write: true, apply_patch: false },
    ],
    [
      "group expansion and direct deny",
      { allow: ["group:fs"], deny: ["write"] },
      { read: true, write: false, apply_patch: true },
    ],
  ] as const)("renders policy-controlled switches: %s", async (_name, tools, expected) => {
    const { container } = mountTools({
      configForm: {
        agents: { entries: { main: { tools } } },
      },
      catalog: policyCatalog(Object.keys(expected), "full"),
    });
    await Promise.resolve();

    expect(
      Object.fromEntries(
        Array.from(container.querySelectorAll(".agent-tool-card"), (card) => [
          content(card, ".agent-tool-title"),
          card.querySelector<HTMLInputElement>("input.settings-toggle__input")?.checked,
        ]),
      ),
    ).toEqual(expected);
  });
});
