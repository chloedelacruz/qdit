import { describe, expect, it } from "vitest";

import { conflict, rpcError } from "./errors";

const MILESTONE = "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61";
const options = { notFound: "No such project.", reasons: ["node_already_linked", "doc_not_linked"] as const };

describe("rpcError", () => {
  it("maps P0002 to not_found with the endpoint's message", () => {
    expect(rpcError({ code: "P0002", message: "That doc is not linked to this project." }, options).toBody()).toEqual({
      error: { code: "not_found", message: "No such project.", details: null },
    });
  });

  it("maps QD409 to conflict with the reason and the hinted milestone", () => {
    expect(rpcError({ code: "QD409", message: "node_already_linked", hint: MILESTONE }, options).toBody().error).toEqual({
      code: "conflict",
      message: expect.any(String),
      details: { reason: "node_already_linked", milestone_id: MILESTONE },
    });
  });

  it("drops a hint that is not a milestone id", () => {
    expect(rpcError({ code: "QD409", message: "doc_not_linked", hint: "" }, options).details).toEqual({
      reason: "doc_not_linked",
    });
  });

  it("does not pass through a reason the endpoint does not list", () => {
    const error = rpcError({ code: "QD409", message: "doc_linked_elsewhere" }, options);
    expect(error.status).toBe(500);
    expect(error.code).toBe("internal_error");
  });

  it("leaves everything else to databaseError", () => {
    expect(rpcError({ code: "42501", message: "x" }, options).code).toBe("forbidden");
    expect(rpcError({ code: "", message: "fetch failed" }, options).code).toBe("unavailable");
  });
});

describe("conflict", () => {
  it("omits milestone_id when there is none", () => {
    expect(conflict("milestone_not_linked").toBody().error.details).toEqual({ reason: "milestone_not_linked" });
  });
});
