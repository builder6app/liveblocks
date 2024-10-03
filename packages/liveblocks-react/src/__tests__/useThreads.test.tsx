import "@testing-library/jest-dom";

import { nanoid, ServerMsgCode } from "@liveblocks/core";
import type { AST } from "@liveblocks/query-parser";
import { QueryParser } from "@liveblocks/query-parser";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { addSeconds } from "date-fns";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import React, { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { POLLING_INTERVAL } from "../room";
import { makeRoomThreadsQueryKey } from "../umbrella-store";
import { dummyThreadData, dummyThreadInboxNotificationData } from "./_dummies";
import MockWebSocket, { websocketSimulator } from "./_MockWebSocket";
import {
  mockGetInboxNotifications,
  mockGetThread,
  mockGetThreads,
} from "./_restMocks";
import { createContextsForTest } from "./_utils";

const server = setupServer();

const parser = new QueryParser({
  fields: {},
  indexableFields: {
    metadata: "mixed",
  },
});

const getFilter = (
  clauses: AST.Clause[],
  indexedFieldKey: string,
  filterKey: string
) => {
  const filter = clauses.find(
    (clause) =>
      clause.field._kind === "IndexedField" &&
      clause.field.base.name === indexedFieldKey &&
      clause.field.key === filterKey
  );

  return {
    key: filter?.field._kind === "IndexedField" ? filter.field.key : "",
    operator: filter?.operator.op,
    value: filter?.value.value,
  };
};

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

beforeEach(() => {
  MockWebSocket.reset();
});

afterEach(() => {
  MockWebSocket.reset();
  server.resetHandlers();
  jest.clearAllTimers();
  jest.clearAllMocks();
});

afterAll(() => server.close());

describe("useThreads", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test("should fetch threads", async () => {
    const roomId = nanoid();
    const threads = [dummyThreadData({ roomId })];

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: threads,
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    expect(result.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount();
  });

  test("should be referentially stable after a re-render", async () => {
    const roomId = nanoid();
    const threads = [dummyThreadData({ roomId })];

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: threads,
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount, rerender } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    expect(result.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    const oldResult = result.current;

    rerender();

    expect(oldResult).toBe(result.current);

    unmount();
  });

  test("multiple instances of useThreads should not fetch threads multiple times (dedupe requests)", async () => {
    const roomId = nanoid();
    const threads = [dummyThreadData({ roomId })];
    let getThreadsReqCount = 0;

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        getThreadsReqCount++;
        return res(
          ctx.json({
            data: threads,
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { unmount, rerender } = renderHook(
      () => {
        useThreads();
        useThreads();
        useThreads();
      },
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    await waitFor(() => expect(getThreadsReqCount).toBe(1));

    rerender();

    expect(getThreadsReqCount).toBe(1);

    unmount();
  });

  test("should fetch threads for a given query", async () => {
    const roomId = nanoid();
    const pinnedThread = dummyThreadData({
      roomId,
      metadata: {
        pinned: true,
      },
    });
    const unpinnedThread = dummyThreadData({
      roomId,
      metadata: {
        pinned: false,
      },
    });

    server.use(
      mockGetThreads(async (req, res, ctx) => {
        const query = req.url.searchParams.get("query");
        const parseRes = parser.parse(query ?? "");

        const metadataPinned = getFilter(
          parseRes.query.clauses,
          "metadata",
          "pinned"
        );

        return res(
          ctx.json({
            data: [pinnedThread, unpinnedThread].filter(
              (thread) => thread.metadata.pinned === metadataPinned.value
            ),
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest<{
      pinned: boolean;
    }>();

    const { result, unmount } = renderHook(
      () => useThreads({ query: { metadata: { pinned: true } } }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [pinnedThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount();
  });

  test("should fetch threads for a given query (multiple criteria)", async () => {
    const roomId = nanoid();
    const redPinnedThread = dummyThreadData({
      roomId,
      metadata: { pinned: true, color: "red" },
    });
    const bluePinnedThread = dummyThreadData({
      roomId,
      metadata: { pinned: true, color: "blue" },
    });
    const redUnpinnedThread = dummyThreadData({
      roomId,
      metadata: { pinned: false, color: "red" },
    });
    const blueUnpinnedThread = dummyThreadData({
      roomId,
      metadata: { pinned: false, color: "blue" },
    });

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: [
              bluePinnedThread,
              blueUnpinnedThread,
              redPinnedThread,
              redUnpinnedThread,
            ], // removed any filtering so that we ensure the filtering is done properly on the client side, it shouldn't matter what the server returns
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest<{
      pinned: boolean;
      color: string;
    }>();

    const { result, unmount } = renderHook(
      () =>
        useThreads({
          query: { metadata: { pinned: true, color: "red" } },
        }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [redPinnedThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount();

    const { result: result2, unmount: unmount2 } = renderHook(
      () =>
        useThreads({
          query: { metadata: { color: "red" } },
        }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result2.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result2.current).toEqual({
        isLoading: false,
        threads: [redPinnedThread, redUnpinnedThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount2();

    const { result: result3, unmount: unmount3 } = renderHook(
      () =>
        useThreads({
          query: { metadata: { color: "red", pinned: true } },
        }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result3.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result3.current).toEqual({
        isLoading: false,
        threads: [redPinnedThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount3();

    const { result: result4, unmount: unmount4 } = renderHook(
      () =>
        useThreads({
          query: { metadata: { color: "nonexisting", pinned: true } },
        }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result4.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result4.current).toEqual({
        isLoading: false,
        threads: [],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount4();

    const { result: result5, unmount: unmount5 } = renderHook(
      () =>
        useThreads({
          query: { metadata: { color: "nonexisting" } },
        }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result5.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result5.current).toEqual({
        isLoading: false,
        threads: [],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount5();

    const { result: result6, unmount: unmount6 } = renderHook(
      () => useThreads({ query: { metadata: { pinned: true } } }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result6.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result6.current).toEqual({
        isLoading: false,
        threads: [bluePinnedThread, redPinnedThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount6();

    const { result: result7, unmount: unmount7 } = renderHook(
      () =>
        useThreads({
          query: { metadata: { color: { startsWith: "blu" }, pinned: true } },
        }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result7.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result7.current).toEqual({
        isLoading: false,
        threads: [bluePinnedThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount7();
  });

  test("shoud fetch threads for a given query with a startsWith filter", async () => {
    const roomId = nanoid();
    const liveblocksEngineeringThread = dummyThreadData({
      roomId,
      metadata: {
        organization: "liveblocks:engineering",
      },
    });
    const liveblocksDesignThread = dummyThreadData({
      roomId,
      metadata: {
        organization: "liveblocks:design",
      },
    });
    const acmeEngineeringThread = dummyThreadData({
      roomId,
      metadata: {
        organization: "acme",
      },
    });

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: [
              liveblocksEngineeringThread,
              liveblocksDesignThread,
              acmeEngineeringThread,
            ],
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest<{
      organization: string;
    }>();

    const { result, unmount } = renderHook(
      () =>
        useThreads({
          query: {
            metadata: {
              organization: {
                startsWith: "liveblocks:",
              },
            },
          },
        }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [liveblocksEngineeringThread, liveblocksDesignThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount();
  });

  test("should dedupe fetch threads for a given query", async () => {
    const roomId = nanoid();
    const threads = [dummyThreadData({ roomId })];
    let getThreadsReqCount = 0;

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        getThreadsReqCount++;
        return res(
          ctx.json({
            data: threads,
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest<{
      pinned: boolean;
    }>();

    const { unmount } = renderHook(
      () => {
        useThreads({ query: { metadata: { pinned: true } } });
        useThreads({ query: { metadata: { pinned: true } } });
      },
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    await waitFor(() => expect(getThreadsReqCount).toBe(1));

    unmount();
  });

  test("should refetch threads if query changed dynamically and should display threads instantly if query already been done in the past", async () => {
    const roomId = nanoid();
    const pinnedThread = dummyThreadData({
      roomId,
      metadata: {
        pinned: true,
      },
    });
    const unpinnedThread = dummyThreadData({
      roomId,
      metadata: {
        pinned: false,
      },
    });

    server.use(
      mockGetThreads(async (req, res, ctx) => {
        const query = req.url.searchParams.get("query");
        const parseRes = parser.parse(query ?? "");

        const metadataPinned = getFilter(
          parseRes.query.clauses,
          "metadata",
          "pinned"
        );

        return res(
          ctx.json({
            data: [pinnedThread, unpinnedThread].filter(
              (thread) => thread.metadata.pinned === metadataPinned.value
            ),
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest<{
      pinned: boolean;
    }>();

    const { result, unmount, rerender } = renderHook(
      ({ pinned }: { pinned: boolean }) =>
        useThreads({ query: { metadata: { pinned } } }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
        initialProps: { pinned: true },
      }
    );

    expect(result.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [pinnedThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    rerender({ pinned: false });

    expect(result.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [unpinnedThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    rerender({ pinned: true });

    // Pinned threads are displayed instantly because we already fetched them previously
    expect(result.current).toEqual({
      isLoading: false,
      threads: [pinnedThread],
      fetchMore: expect.any(Function),
      isFetchingMore: false,
      hasFetchedAll: true,
      fetchMoreError: undefined,
    });

    unmount();
  });

  test("multiple instances of RoomProvider should render their corresponding threads correctly", async () => {
    const room1Id = nanoid();
    const room2Id = nanoid();
    const room1Threads = [dummyThreadData({ roomId: room1Id })];
    const room2Threads = [dummyThreadData({ roomId: room2Id })];

    server.use(
      mockGetThreads((req, res, ctx) => {
        const roomId = req.params.roomId;
        if (roomId === room1Id) {
          return res(
            ctx.json({
              data: room1Threads,
              inboxNotifications: [],
              deletedThreads: [],
              deletedInboxNotifications: [],
              meta: {
                requestedAt: new Date().toISOString(),
                nextCursor: null,
              },
            })
          );
        } else if (roomId === room2Id) {
          return res(
            ctx.json({
              data: room2Threads,
              inboxNotifications: [],
              deletedThreads: [],
              deletedInboxNotifications: [],
              meta: {
                requestedAt: new Date().toISOString(),
                nextCursor: null,
              },
            })
          );
        }

        return res(ctx.status(404));
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result: room1Result, unmount: unmountRoom1 } = renderHook(
      () => useThreads(),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={room1Id}>{children}</RoomProvider>
        ),
      }
    );

    const { result: room2Result, unmount: unmountRoom2 } = renderHook(
      () => useThreads(),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={room2Id}>{children}</RoomProvider>
        ),
      }
    );

    expect(room1Result.current).toEqual({ isLoading: true });
    expect(room2Result.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(room1Result.current).toEqual({
        isLoading: false,
        threads: room1Threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    await waitFor(() =>
      expect(room2Result.current).toEqual({
        isLoading: false,
        threads: room2Threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmountRoom1();
    unmountRoom2();
  });

  test("should correctly display threads if room id changed dynamically and should display threads instantly if query for the room already been done in the past", async () => {
    const room1Id = nanoid();
    const room2Id = nanoid();
    const room1Threads = [dummyThreadData({ roomId: room1Id })];
    const room2Threads = [dummyThreadData({ roomId: room2Id })];

    server.use(
      mockGetThreads((req, res, ctx) => {
        if (req.params.roomId === room1Id) {
          return res(
            ctx.json({
              data: room1Threads,
              inboxNotifications: [],
              deletedThreads: [],
              deletedInboxNotifications: [],
              meta: {
                requestedAt: new Date().toISOString(),
                nextCursor: null,
              },
            })
          );
        } else if (req.params.roomId === room2Id) {
          return res(
            ctx.json({
              data: room2Threads,
              inboxNotifications: [],
              deletedThreads: [],
              deletedInboxNotifications: [],
              meta: {
                requestedAt: new Date().toISOString(),
                nextCursor: null,
              },
            })
          );
        }

        return res(ctx.status(404));
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const RoomIdDispatchContext = React.createContext<
      ((value: string) => void) | null
    >(null);

    const Wrapper = ({ children }: { children: ReactNode }) => {
      const [roomId, setRoomId] = React.useState(room1Id);

      return (
        <RoomIdDispatchContext.Provider value={setRoomId}>
          <RoomProvider id={roomId}>{children}</RoomProvider>
        </RoomIdDispatchContext.Provider>
      );
    };

    const useThreadsContainer = () => {
      const setRoomId = React.useContext(RoomIdDispatchContext);
      const state = useThreads();
      return { state, setRoomId };
    };

    const { result, unmount } = renderHook(() => useThreadsContainer(), {
      wrapper: Wrapper,
    });

    expect(result.current.state).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        isLoading: false,
        threads: room1Threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    act(() => {
      result.current.setRoomId?.(room2Id);
    });

    expect(result.current.state).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        isLoading: false,
        threads: room2Threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    act(() => {
      result.current.setRoomId?.(room1Id);
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({
        isLoading: false,
        threads: room1Threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount();
  });

  test("should include an error object in the returned value if initial fetch throws an error", async () => {
    const roomId = nanoid();

    server.use(
      mockGetThreads((_req, res, ctx) => {
        // Mock an error response from the server for the initial fetch
        return res(ctx.status(500));
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    expect(result.current).toEqual({ isLoading: true });

    await jest.advanceTimersToNextTimerAsync(); // fetch attempt 1

    await jest.advanceTimersByTimeAsync(5_000); // fetch attempt 2
    expect(result.current).toEqual({ isLoading: true });

    await jest.advanceTimersByTimeAsync(5_000); // fetch attempt 3
    expect(result.current).toEqual({ isLoading: true });

    await jest.advanceTimersByTimeAsync(10_000); // fetch attempt 4
    expect(result.current).toEqual({ isLoading: true });

    await jest.advanceTimersByTimeAsync(15_000); // fetch attempt 5

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        error: expect.any(Error),
      })
    );

    unmount();
  });

  test("should sort threads by creation date before returning", async () => {
    const roomId = nanoid();
    const oldThread = dummyThreadData({
      roomId,
      createdAt: new Date("2021-01-01T00:00:00Z"),
    });
    const newThread = dummyThreadData({
      roomId,
      createdAt: new Date("2021-01-02T00:00:00Z"),
    });

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: [newThread, oldThread], // The order is intentionally reversed to test if the hook sorts the threads by creation date
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount } = renderHook(
      () => ({
        threads: useThreads(),
      }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result.current.threads).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current.threads).toEqual({
        isLoading: false,
        threads: [oldThread, newThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount();
  });

  test("should sort threads by creation date before returning (when GET THREADS resolves before GET INBOX NOTIFICATIONS request)", async () => {
    const roomId = nanoid();
    const oldThread = dummyThreadData({
      roomId,
      createdAt: new Date("2021-01-01T00:00:00Z"),
    });
    const newThread = dummyThreadData({
      roomId,
      createdAt: new Date("2021-01-02T00:00:00Z"),
    });
    const inboxNotification = dummyThreadInboxNotificationData({
      roomId,
      threadId: oldThread.id,
    });

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: [newThread],
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      }),
      mockGetInboxNotifications(async (_req, res, ctx) => {
        // Mock a delay in response so that GET THREADS request is resolved before GET NOTIFICATIONS request
        ctx.delay(100);
        return res(
          ctx.json({
            threads: [oldThread],
            inboxNotifications: [inboxNotification],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
      liveblocks: { useInboxNotifications },
    } = createContextsForTest();

    const { result, unmount } = renderHook(
      () => ({
        threads: useThreads(),
        inboxNotifications: useInboxNotifications(),
      }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result.current.threads).toEqual({ isLoading: true });
    expect(result.current.inboxNotifications).toEqual({ isLoading: true });

    jest.advanceTimersByTime(100);

    await waitFor(() =>
      expect(result.current.threads).toEqual({
        isLoading: false,
        threads: [oldThread, newThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount();
  });

  test("should sort threads by creation date before returning (when GET THREADS resolves after GET INBOX NOTIFICATIONS request)", async () => {
    const roomId = nanoid();
    const oldThread = dummyThreadData({
      roomId,
      createdAt: new Date("2021-01-01T00:00:00Z"),
    });
    const newThread = dummyThreadData({
      roomId,
      createdAt: new Date("2021-01-02T00:00:00Z"),
    });
    const inboxNotification = dummyThreadInboxNotificationData({
      roomId,
      threadId: newThread.id,
    });

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        // Mock a delay in response so that GET THREADS request is resolved after GET NOTIFICATIONS request
        ctx.delay(100);
        return res(
          ctx.json({
            data: [oldThread],
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      }),
      mockGetInboxNotifications(async (_req, res, ctx) => {
        return res(
          ctx.json({
            threads: [newThread],
            inboxNotifications: [inboxNotification],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
      liveblocks: { useInboxNotifications },
    } = createContextsForTest();

    const { result, unmount } = renderHook(
      () => ({
        threads: useThreads(),
        inboxNotifications: useInboxNotifications(),
      }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result.current.threads).toEqual({ isLoading: true });
    expect(result.current.inboxNotifications).toEqual({ isLoading: true });

    jest.advanceTimersByTime(100);

    await waitFor(() =>
      expect(result.current.threads).toEqual({
        isLoading: false,
        threads: [oldThread, newThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount();
  });

  test("should not return deleted threads", async () => {
    const roomId = nanoid();
    const thread1 = dummyThreadData({ roomId });
    const thread2WithDeletedAt = dummyThreadData({
      roomId,

      // @ts-expect-error: deletedAt isn't publicly typed on ThreadData
      deletedAt: new Date(),
    });

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: [],
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
      umbrellaStore,
    } = createContextsForTest();

    umbrellaStore.force_set((state) => ({
      ...state,
      rawThreadsById: {
        [thread1.id]: thread1,
        [thread2WithDeletedAt.id]: thread2WithDeletedAt,
      },
      queries: {
        [makeRoomThreadsQueryKey(roomId, { metadata: {} })]: {
          isLoading: false,
          data: undefined,
        },
      },
    }));

    const { result, unmount } = renderHook(
      () => useThreads({ query: { metadata: {} } }),
      {
        wrapper: ({ children }) => (
          <RoomProvider id={roomId}>{children}</RoomProvider>
        ),
      }
    );

    expect(result.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [thread1], // thread2WithDeleteAt should not be returned
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount();
  });

  test("should update threads if room has been mounted after being unmounted", async () => {
    const roomId = nanoid();
    let threads = [dummyThreadData({ roomId }), dummyThreadData({ roomId })];
    const originalThreads = [...threads];

    server.use(
      mockGetThreads(async (req, res, ctx) => {
        const url = new URL(req.url);
        const since = url.searchParams.get("since");

        if (since) {
          const updatedThreads = threads.filter((thread) => {
            if (thread.updatedAt === undefined) return false;
            return new Date(thread.updatedAt) >= new Date(since);
          });

          return res(
            ctx.json({
              data: updatedThreads,
              deletedThreads: [],
              inboxNotifications: [],
              deletedInboxNotifications: [],
              meta: {
                requestedAt: new Date().toISOString(),
                nextCursor: null,
              },
            })
          );
        }

        return res(
          ctx.json({
            data: threads,
            deletedThreads: [],
            inboxNotifications: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const firstRenderResult = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    expect(firstRenderResult.result.current).toEqual({ isLoading: true });

    // Threads should be displayed after the server responds with the threads
    await waitFor(() =>
      expect(firstRenderResult.result.current).toEqual({
        isLoading: false,
        threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    firstRenderResult.unmount();

    // Add a new thread to the threads array to simulate a new thread being added to the room
    threads = [...originalThreads, dummyThreadData({ roomId })];

    // Render the RoomProvider again and verify the threads are updated
    const secondRenderResult = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    // Threads (outdated ones) should be displayed instantly because we already fetched them previously
    expect(secondRenderResult.result.current).toEqual({
      isLoading: false,
      threads: originalThreads,
      fetchMore: expect.any(Function),
      isFetchingMore: false,
      hasFetchedAll: true,
      fetchMoreError: undefined,
    });

    // The updated threads should be displayed after the server responds with the updated threads (either due to a fetch request to get all threads or just the updated threads)
    await waitFor(() => {
      expect(secondRenderResult.result.current).toEqual({
        isLoading: false,
        threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      });
    });

    secondRenderResult.unmount();
  });

  test("should not refetch threads if room has been mounted after being unmounted if another RoomProvider for the same id is still mounted", async () => {
    const roomId = nanoid();
    const threads = [dummyThreadData({ roomId })];
    let getThreadsReqCount = 0;

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        getThreadsReqCount++;
        return res(
          ctx.json({
            data: threads,
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
      client,
    } = createContextsForTest();

    const Room = () => {
      return (
        <RoomProvider id={roomId}>
          <Threads />
        </RoomProvider>
      );
    };

    const FirstRoom = Room;
    const SecondRoom = Room;

    const Threads = () => {
      useThreads();
      return null;
    };

    // Render a RoomProvider for the room id
    const { rerender, unmount: unmountFirstRoom } = render(<FirstRoom />);

    // Render another RoomProvider for the same room id
    const { unmount: unmountSecondRoom } = render(<SecondRoom />);

    // A new fetch request for the threads should have been made
    await waitFor(() => expect(getThreadsReqCount).toBe(1));

    const room = client.getRoom(roomId);
    expect(room).not.toBeNull();
    if (room === null) return;

    // Rerender the first RoomProvider and verify a new fetch request wasn't initiated
    rerender(<FirstRoom />);

    // A new fetch request for the threads should not have been made
    expect(getThreadsReqCount).toBe(1);

    unmountFirstRoom();
    unmountSecondRoom();
  });

  test("should update threads for a room when the browser comes back online", async () => {
    const roomId = nanoid();
    const threads = [dummyThreadData({ roomId }), dummyThreadData({ roomId })];

    server.use(
      mockGetThreads(async (req, res, ctx) => {
        const url = new URL(req.url);
        const since = url.searchParams.get("since");

        if (since) {
          const updatedThreads = threads.filter((thread) => {
            if (thread.updatedAt === undefined) return false;
            return new Date(thread.updatedAt) >= new Date(since);
          });

          return res(
            ctx.json({
              data: updatedThreads,
              deletedThreads: [],
              inboxNotifications: [],
              deletedInboxNotifications: [],
              meta: {
                requestedAt: new Date().toISOString(),
                nextCursor: null,
              },
            })
          );
        }

        return res(
          ctx.json({
            data: threads,
            deletedThreads: [],
            inboxNotifications: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    expect(result.current).toEqual({ isLoading: true });

    // Threads should be displayed after the server responds with the threads
    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    // Add a new thread to the threads array to simulate a new thread being added to the room
    threads.push(dummyThreadData({ roomId }));

    // Simulate browser going online
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    // The updated threads should be displayed after the server responds with the updated threads (either due to a fetch request to get all threads or just the updated threads)
    await waitFor(() => {
      expect(result.current).toEqual({
        isLoading: false,
        threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      });
    });

    unmount();
  });
});

describe("useThreads: error", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers(); // Restores the real timers
  });

  test("should retry with exponential backoff on error", async () => {
    const roomId = nanoid();
    let getThreadsReqCount = 0;

    server.use(
      mockGetThreads((_req, res, ctx) => {
        getThreadsReqCount++;
        // Mock an error response from the server for the initial fetch
        return res(ctx.status(500));
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    expect(result.current).toEqual({ isLoading: true });

    // A new fetch request for the threads should have been made after the initial render
    await waitFor(() => expect(getThreadsReqCount).toBe(1));

    // An error will only be thrown after the initial load failed, which
    // happens after 5 retries (>1 minute) at earliest.
    await jest.advanceTimersByTimeAsync(1_000);

    expect(result.current).toEqual({ isLoading: true });

    // The first retry should be made after 5s
    await jest.advanceTimersByTimeAsync(5_000);
    // A new fetch request for the threads should have been made after the first retry
    await waitFor(() => expect(getThreadsReqCount).toBe(2));

    // The second retry should be made after 5s
    await jest.advanceTimersByTimeAsync(5_000);
    await waitFor(() => expect(getThreadsReqCount).toBe(3));

    // The third retry should be made after 10s
    await jest.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(getThreadsReqCount).toBe(4));

    // The fourth retry should be made after 15s
    await jest.advanceTimersByTimeAsync(15_000);
    await waitFor(() => expect(getThreadsReqCount).toBe(5));

    // Won't try more than 5 attempts
    await jest.advanceTimersByTimeAsync(20_000);
    await waitFor(() => expect(getThreadsReqCount).toBe(5));

    // and so on...

    unmount();
  });
});

describe("useThreads: polling", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });
  test("should poll threads every x seconds", async () => {
    const roomId = nanoid();
    const threads = [dummyThreadData({ roomId })];
    const now = new Date().toISOString();
    let getThreadsReqCount = 0;

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        getThreadsReqCount++;
        return res(
          ctx.json({
            data: threads,
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: now,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const Room = () => {
      return (
        <RoomProvider id={roomId}>
          <Threads />
        </RoomProvider>
      );
    };

    const Threads = () => {
      useThreads();
      return null;
    };

    const { unmount } = render(<Room />);

    // A new fetch request for the threads should have been made after the initial render
    await waitFor(() => expect(getThreadsReqCount).toBe(1));

    // Wait for the first polling to occur after the initial render
    jest.advanceTimersByTime(POLLING_INTERVAL);
    await waitFor(() => expect(getThreadsReqCount).toBe(2));

    // Advance time to simulate the polling interval
    jest.advanceTimersByTime(POLLING_INTERVAL);
    // Wait for the second polling to occur
    await waitFor(() => expect(getThreadsReqCount).toBe(3));

    unmount();
  });

  test("should not poll if useThreads isn't used", async () => {
    const roomId = nanoid();
    const threads = [dummyThreadData({ roomId })];
    const now = new Date().toISOString();
    let hasCalledGetThreads = false;

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        hasCalledGetThreads = true;
        return res(
          ctx.json({
            data: threads,
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: now,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider },
    } = createContextsForTest();

    const Room = () => {
      return (
        <RoomProvider id={roomId}>
          <NoThreads />
        </RoomProvider>
      );
    };

    const NoThreads = () => {
      return null;
    };

    const { unmount } = render(<Room />);

    jest.advanceTimersByTime(POLLING_INTERVAL);
    await waitFor(() => expect(hasCalledGetThreads).toBe(false));

    jest.advanceTimersByTime(POLLING_INTERVAL);
    await waitFor(() => expect(hasCalledGetThreads).toBe(false));

    unmount();
  });
});

describe("WebSocket events", () => {
  test("COMMENT_CREATED event should refresh thread", async () => {
    const roomId = nanoid();
    const newThread = dummyThreadData({ roomId });

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: [],
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      }),
      mockGetThread({ threadId: newThread.id }, async (_req, res, ctx) => {
        return res(
          ctx.json({
            thread: newThread,
            inboxNotification: undefined,
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    const sim = await websocketSimulator();

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
      })
    );

    sim.simulateIncomingMessage({
      type: ServerMsgCode.COMMENT_CREATED,
      threadId: newThread.id,
      commentId: newThread.comments[0]!.id,
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [newThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
      })
    );

    unmount();
  });

  test("COMMENT_DELETED event should delete thread if getThread return 404", async () => {
    const roomId = nanoid();
    const newThread = dummyThreadData({ roomId });

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: [newThread],
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      }),
      mockGetThread({ threadId: newThread.id }, async (_req, res, ctx) => {
        return res(ctx.status(404));
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    const sim = await websocketSimulator();

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [newThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
      })
    );

    // This should refresh the thread and get a 404
    sim.simulateIncomingMessage({
      type: ServerMsgCode.COMMENT_DELETED,
      threadId: newThread.id,
      commentId: newThread.comments[0]!.id,
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
      })
    );

    unmount();
  });

  test("THREAD_DELETED event should delete thread", async () => {
    const roomId = nanoid();
    const newThread = dummyThreadData({ roomId });

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: [newThread],
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    const sim = await websocketSimulator();

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [newThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
      })
    );

    sim.simulateIncomingMessage({
      type: ServerMsgCode.THREAD_DELETED,
      threadId: newThread.id,
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
      })
    );

    unmount();
  });

  test("Websocket event should not refresh thread if updatedAt is earlier than the cached updatedAt", async () => {
    const roomId = nanoid();
    const now = new Date();
    const initialThread = dummyThreadData({
      roomId,
      updatedAt: now,
      metadata: { counter: 0 },
    });
    const delayedThread = {
      ...initialThread,
      updatedAt: addSeconds(now, 1),
      metadata: { counter: 1 },
    };
    const latestThread = {
      ...initialThread,
      updatedAt: addSeconds(now, 2),
      metadata: { counter: 2 },
    };

    let callIndex = 0;

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: [initialThread],
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      }),
      mockGetThread({ threadId: initialThread.id }, async (_req, res, ctx) => {
        if (callIndex === 0) {
          callIndex++;
          return res(
            ctx.json({
              thread: latestThread,
              inboxNotification: undefined,
            })
          );
        } else if (callIndex === 1) {
          callIndex++;
          return res(
            ctx.json({
              thread: delayedThread,
              inboxNotification: undefined,
            })
          );
        } else {
          throw new Error("Only two calls to getThreads are expected");
        }
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    const sim = await websocketSimulator();

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [initialThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
      })
    );

    // First thread metadata updated event returns the most recent thread
    sim.simulateIncomingMessage({
      type: ServerMsgCode.THREAD_METADATA_UPDATED,
      threadId: initialThread.id,
    });

    // Second thread metadata updated event returns an old thread
    sim.simulateIncomingMessage({
      type: ServerMsgCode.THREAD_METADATA_UPDATED,
      threadId: initialThread.id,
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [latestThread],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
      })
    );

    unmount();
  });
});

describe("useThreadsSuspense", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test("should fetch threads", async () => {
    const roomId = nanoid();
    const threads = [dummyThreadData({ roomId })];

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: threads,
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: {
        RoomProvider,
        suspense: { useThreads },
      },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>
          <Suspense fallback={<div>Loading</div>}>{children}</Suspense>
        </RoomProvider>
      ),
    });

    expect(result.current).toEqual(null);

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
      })
    );

    unmount();
  });

  test("should be referentially stable after a re-render", async () => {
    const roomId = nanoid();
    const threads = [dummyThreadData({ roomId })];

    server.use(
      mockGetThreads(async (_req, res, ctx) => {
        return res(
          ctx.json({
            data: threads,
            inboxNotifications: [],
            deletedThreads: [],
            deletedInboxNotifications: [],
            meta: {
              requestedAt: new Date().toISOString(),
              nextCursor: null,
            },
          })
        );
      })
    );

    const {
      room: {
        RoomProvider,
        suspense: { useThreads },
      },
    } = createContextsForTest();

    const { result, unmount, rerender } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>
          <Suspense fallback={<div>Loading</div>}>{children}</Suspense>
        </RoomProvider>
      ),
    });

    expect(result.current).toEqual(null);

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads,
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
      })
    );

    const oldResult = result.current;

    rerender();

    expect(oldResult).toBe(result.current);

    unmount();
  });
});

describe("useThreadsSuspense: error", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers(); // Restores the real timers
  });

  test("should trigger error boundary if initial fetch throws an error", async () => {
    const roomId = nanoid();
    let getThreadsReqCount = 0;

    server.use(
      mockGetThreads((_req, res, ctx) => {
        getThreadsReqCount++;
        return res(ctx.status(500));
      })
    );

    const {
      room: {
        RoomProvider,
        suspense: { useThreads },
      },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>
          <ErrorBoundary
            FallbackComponent={({ resetErrorBoundary }) => {
              return (
                <>
                  <div>There was an error while getting threads.</div>
                  <button onClick={resetErrorBoundary}>Retry</button>
                </>
              );
            }}
          >
            <Suspense fallback={<div>Loading</div>}>{children}</Suspense>
          </ErrorBoundary>
        </RoomProvider>
      ),
    });

    expect(result.current).toEqual(null);

    expect(screen.getByText("Loading")).toBeInTheDocument();

    // Wait until all fetch attempts have been done
    await jest.advanceTimersToNextTimerAsync(); // fetch attempt 1

    // The first retry should be made after 5s
    await jest.advanceTimersByTimeAsync(5_000);
    // A new fetch request for the threads should have been made after the first retry
    await waitFor(() => expect(getThreadsReqCount).toBe(2));

    // The second retry should be made after 5s
    await jest.advanceTimersByTimeAsync(5_000);
    await waitFor(() => expect(getThreadsReqCount).toBe(3));

    // The third retry should be made after 10s
    await jest.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(getThreadsReqCount).toBe(4));

    // The fourth retry should be made after 15s
    await jest.advanceTimersByTimeAsync(15_000);
    await waitFor(() => expect(getThreadsReqCount).toBe(5));

    // Check if the error boundary's fallback is displayed
    await waitFor(() => {
      expect(
        screen.getByText("There was an error while getting threads.")
      ).toBeInTheDocument();
    });

    // Wait until the error boundary auto-clears
    await jest.advanceTimersByTimeAsync(5_000);

    // Simulate clicking the retry button
    fireEvent.click(screen.getByText("Retry"));

    // The error boundary's fallback should be cleared
    await waitFor(() => {
      expect(screen.getByText("Loading")).toBeInTheDocument();
    });

    unmount();
  });
});

describe("useThreads pagination", () => {
  test("should set `hasFetchedAll` to false while cursor data is present", async () => {
    const roomId = nanoid();

    const threadsPageOne = [dummyThreadData({ roomId })];
    const threadsPageTwo = [dummyThreadData({ roomId })];
    const threadsPageThree = [dummyThreadData({ roomId })];

    let isPageTwoRequested = false;
    let isPageThreeRequested = false;

    server.use(
      mockGetThreads(async (req, res, ctx) => {
        const url = new URL(req.url);
        const cursor = url.searchParams.get("cursor");

        // Request for Page 2
        if (cursor === "cursor-1") {
          isPageTwoRequested = true;
          return res(
            ctx.json({
              data: threadsPageTwo,
              inboxNotifications: [],
              deletedThreads: [],
              deletedInboxNotifications: [],
              meta: {
                requestedAt: new Date().toISOString(),
                nextCursor: "cursor-2",
              },
            })
          );
        }
        // Request for Page 3
        else if (cursor === "cursor-2") {
          isPageThreeRequested = true;
          return res(
            ctx.json({
              data: threadsPageThree,
              inboxNotifications: [],
              deletedThreads: [],
              deletedInboxNotifications: [],
              meta: {
                requestedAt: new Date().toISOString(),
                nextCursor: null,
              },
            })
          );
        }
        // Request for the first page
        else {
          return res(
            ctx.json({
              data: threadsPageOne,
              inboxNotifications: [],
              deletedThreads: [],
              deletedInboxNotifications: [],
              meta: {
                requestedAt: new Date().toISOString(),
                nextCursor: "cursor-1",
              },
            })
          );
        }
      })
    );

    const {
      room: { RoomProvider, useThreads },
    } = createContextsForTest();

    const { result, unmount } = renderHook(() => useThreads(), {
      wrapper: ({ children }) => (
        <RoomProvider id={roomId}>{children}</RoomProvider>
      ),
    });

    expect(result.current).toEqual({ isLoading: true });

    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [...threadsPageOne],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: false,
        fetchMoreError: undefined,
      })
    );

    const fetchMore = result.current.fetchMore!;

    fetchMore();
    await waitFor(() => expect(isPageTwoRequested).toBe(true));
    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [...threadsPageOne, ...threadsPageTwo],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: false,
        fetchMoreError: undefined,
      })
    );

    fetchMore();
    await waitFor(() => expect(isPageThreeRequested).toBe(true));
    await waitFor(() =>
      expect(result.current).toEqual({
        isLoading: false,
        threads: [...threadsPageOne, ...threadsPageTwo, ...threadsPageThree],
        fetchMore: expect.any(Function),
        isFetchingMore: false,
        hasFetchedAll: true,
        fetchMoreError: undefined,
      })
    );

    unmount();
  });
});
