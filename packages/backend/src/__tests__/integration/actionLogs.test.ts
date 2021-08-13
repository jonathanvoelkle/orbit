import { getIDForPromptSync, getIDForPromptTask } from "@withorbit/core";
import { migration } from "@withorbit/core2";
import { testQAPrompt } from "@withorbit/sample-data";
import { resetLocalEmulators } from "../emulators";
import { fetchRoute } from "./utils/fetchRoute";
import { setupAuthToken } from "./utils/setupAuthToken";

const testPromptID = getIDForPromptSync(testQAPrompt);
const VALID_ACTION_LOG = [
  {
    id: "z4EBG9j9vzxH39N5Phi4DvKjPPHPATM6GayreCvmvXGrPA3gzAg",
    data: {
      timestampMillis: 15,
      taskID: getIDForPromptTask({
        promptID: testPromptID,
        promptType: testQAPrompt.promptType,
        promptParameters: null,
      }),
      actionLogType: "ingest",
      provenance: null,
    },
  },
];

afterEach(async () => {
  await resetLocalEmulators();
});

it("round-trip request", async () => {
  await setupAuthToken("patch-action-log-round-trip");
  const { status: patchStatus, body: patchBody } = await fetchRoute(
    `/api/actionLogs`,
    {
      method: "PATCH",
      json: VALID_ACTION_LOG,
      authorization: { token: "patch-action-log-round-trip" },
    },
  );
  expect(patchStatus).toBe(204);
  expect(patchBody).toBeUndefined();

  await setupAuthToken("get-action-log-round-trip");
  const { status: getStatus, body: getBody } = await fetchRoute(
    `/api/actionLogs`,
    {
      method: "GET",
      authorization: { token: "get-action-log-round-trip" },
    },
  );
  expect(getStatus).toBe(200);
  expect(getBody).toEqual({
    objectType: "list",
    hasMore: false,
    data: [{ ...VALID_ACTION_LOG[0], objectType: "actionLog" }],
  });
});

describe("[GET] validation", () => {
  it("succeeds with valid parameters", async () => {
    const { status } = await fetchRoute(
      `/api/actionLogs?createdAfterID="someId"&limit=1000`,
    );
    expect(status).toBe(401);
  });

  it("it does not allow limit to be a negative integer", async () => {
    const request = await fetchRoute(`/api/actionLogs?limit=-5`);
    expect(request.status).toBe(400);
    expect(request.body.errors).toMatchObject([
      {
        message: "query/limit must be >= 1",
      },
    ]);
  });

  it("it does not allow limit to be a floating point", async () => {
    const request = await fetchRoute(`/api/actionLogs?limit=-5`);
    expect(request.status).toBe(400);
    expect(request.body.errors).toMatchObject([
      {
        message: "query/limit must be >= 1",
      },
    ]);
  });
});

describe("[PATCH] validation", () => {
  it("it fails when extra properties are provided", async () => {
    const { status, body } = await fetchRoute(`/api/actionLogs`, {
      method: "PATCH",
      json: [{ ...VALID_ACTION_LOG[0], someExtraProperty: true }],
    });
    expect(status).toBe(400);
    expect(body.errors).toMatchObject([
      {
        message: "body/0 must NOT have additional properties",
      },
    ]);
  });

  it("it fails when actionLogType is invalid", async () => {
    const { status, body } = await fetchRoute(`/api/actionLogs`, {
      method: "PATCH",
      json: [
        {
          ...VALID_ACTION_LOG[0],
          data: {
            ...VALID_ACTION_LOG[0].data,
            actionLogType: "invalid_action_log_type",
          },
        },
      ],
    });
    expect(status).toBe(400);
    expect(body.errors).toMatchObject([
      {
        message:
          "body/0/data/actionLogType must be equal to one of the allowed values",
      },
      {
        message: "body/0/data must have required property 'context'",
      },
      {
        message: "body/0/data must have required property 'newTimestampMillis'",
      },
      {
        message: "body/0/data must have required property 'parentActionLogIDs'",
      },
      {
        message: "body/0/data must match a schema in anyOf",
      },
    ]);
  });

  it("also writes core2 events", async () => {
    await setupAuthToken("migrate-action-log");
    const { status: taskDataPatchStatus, body: taskDataPatchBody } =
      await fetchRoute(`/api/taskData`, {
        method: "PATCH",
        json: [{ id: testPromptID, data: testQAPrompt }],
        authorization: { token: "migrate-action-log" },
      });
    expect(taskDataPatchStatus).toBe(204);
    expect(taskDataPatchBody).toBeUndefined();

    const { status: actionLogPatchStatus, body: actionLogPatchBody } =
      await fetchRoute(`/api/actionLogs`, {
        method: "PATCH",
        json: VALID_ACTION_LOG,
        authorization: { token: "migrate-action-log" },
      });
    expect(actionLogPatchStatus).toBe(204);
    expect(actionLogPatchBody).toBeUndefined();

    const { status: eventsGetStatus, body: eventsGetBody } = await fetchRoute(
      "/api/2/events",
      {
        method: "GET",
        authorization: { token: "migrate-action-log" },
      },
    );
    expect(eventsGetStatus).toBe(200);
    expect(eventsGetBody.items.length).toBe(1);
    expect(eventsGetBody.items[0].entityID).toEqual(
      migration.convertCore1ID(testPromptID),
    );
  });
});
