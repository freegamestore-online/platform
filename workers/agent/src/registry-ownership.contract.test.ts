import { afterEach, describe, expect, it, vi } from "vitest";
import idCases from "../../../contracts/registry-ownership-remix/v1/id-cases.json";
import ownershipCases from "../../../contracts/registry-ownership-remix/v1/ownership-cases.json";
import registryCases from "../../../contracts/registry-ownership-remix/v1/registry-cases.json";
import { getConfig } from "./config";
import { ownershipFacts, readRegistry, validateGameId } from "./registry";

afterEach(() => vi.unstubAllGlobals());

describe("registry-ownership contract v1", () => {
  it("accepts canonical IDs only", () => {
    for (const testCase of idCases.cases) expect(validateGameId(testCase.id), testCase.id).toBe(testCase.valid);
  });

  it("preserves registry availability states", async () => {
    for (const testCase of registryCases.cases) {
      vi.stubGlobal("fetch", async (input: unknown) => {
        const state = String(input).includes("raw.githubusercontent") ? testCase.raw : testCase.contents;
        if (state === "success") return new Response(JSON.stringify({ games: [] }));
        if (state === "missing") return new Response("", { status: 404 });
        if (state === "malformed") return new Response(JSON.stringify({ nope: [] }));
        return new Response("", { status: 401 });
      });
      expect((await readRegistry(getConfig("games"), "token")).status, testCase.name).toBe(testCase.expected);
      vi.unstubAllGlobals();
    }
  });

  it("evaluates ownership as facts", () => {
    for (const testCase of ownershipCases.cases)
      expect(
        ownershipFacts(
          testCase.creatorGithub ? { id: "source-game", creatorGithub: testCase.creatorGithub } : { id: "source-game" },
          testCase.login,
          testCase.isOrgMember,
          testCase.isLegacyAcceptedCollaborator,
        ),
        testCase.name,
      ).toEqual(testCase.expected);
  });
});
